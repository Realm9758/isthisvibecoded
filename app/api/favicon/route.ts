import { NextRequest, NextResponse } from 'next/server';

const MAX_FAVICON_BYTES = 128_000;

async function readBoundedImage(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FAVICON_BYTES) {
    throw new Error('Favicon response too large');
  }
  if (!response.body) throw new Error('Favicon response has no body');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FAVICON_BYTES) {
      await reader.cancel();
      throw new Error('Favicon response too large');
    }
    chunks.push(value);
  }

  const image = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    image.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return image;
}

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get('domain');
  if (!domain || !/^[a-zA-Z0-9.-]+$/.test(domain)) {
    return new NextResponse(null, { status: 400 });
  }
  try {
    const upstream = await fetch(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`,
      { next: { revalidate: 86400 } }
    );
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !contentType.toLowerCase().startsWith('image/')) {
      return new NextResponse(null, { status: 502 });
    }
    const image = await readBoundedImage(upstream);
    const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
