import { getHourlyScanCount } from '@/lib/store';

export async function GET() {
  const count = await getHourlyScanCount();
  return Response.json({ count });
}
