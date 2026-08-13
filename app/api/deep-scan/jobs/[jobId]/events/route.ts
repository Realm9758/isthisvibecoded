import { currentScanJobUserId } from '@/lib/scan-job-auth';
import { getOwnedScanJob, listScanJobEvents } from '@/lib/scan-job-store';

export const runtime = 'nodejs';
export const maxDuration = 55;

const TERMINAL = new Set(['complete', 'failed', 'cancelled']);
const encoder = new TextEncoder();

function sse(event: string, data: unknown, id?: number): string {
  const prefix = id === undefined ? '' : `id: ${id}\n`;
  return `${prefix}event: ${event}\ndata: ${JSON.stringify(data).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}\n\n`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const userId = await currentScanJobUserId();
  if (!userId) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const { jobId } = await context.params;
  if (!await getOwnedScanJob(jobId, userId)) {
    return Response.json({ error: 'Scan job not found' }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const requestedAfter = Number(request.headers.get('last-event-id') ?? requestUrl.searchParams.get('after') ?? 0);
  let cursor = Number.isSafeInteger(requestedAfter) && requestedAfter >= 0 ? requestedAfter : 0;
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frame: string) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(frame)); } catch { open = false; }
      };
      enqueue(': connected\n\n');
      let lastHeartbeat = Date.now();
      try {
        while (open && !request.signal.aborted) {
          const events = await listScanJobEvents(jobId, cursor);
          for (const event of events) {
            cursor = event.sequence;
            enqueue(sse(event.type, event.payload, event.sequence));
          }
          const job = await getOwnedScanJob(jobId, userId);
          if (!job || (TERMINAL.has(job.status) && events.length === 0)) break;
          if (Date.now() - lastHeartbeat >= 15_000) {
            enqueue(': keepalive\n\n');
            lastHeartbeat = Date.now();
          }
          await new Promise(resolve => setTimeout(resolve, 750));
        }
      } catch {
        enqueue(sse('stream_notice', {
          message: 'The live connection was interrupted. Ironclad will reconnect from the last saved step.',
          reconnect: true,
        }));
      } finally {
        open = false;
        try { controller.close(); } catch { /* client disconnected */ }
      }
    },
    cancel() { open = false; },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  } });
}
