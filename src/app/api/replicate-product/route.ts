import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import axios, { AxiosError } from 'axios';

export async function POST(req: NextRequest) {
  console.log('Webhook received at:', new Date().toISOString());

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const secret = process.env.WEBHOOK_SECRET!;
  const consumerKey = process.env.WC2_CONSUMER_KEY!;
  const consumerSecret = process.env.WC2_CONSUMER_SECRET!;
  const wcApiUrl = process.env.WC2_API_URL!;

  const signatureHeader = req.headers.get('x-wc-webhook-signature') ||
                          req.headers.get('X-WC-Webhook-Signature');
  const rawBody = await req.text();
  const computedSignature = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');

  if (!signatureHeader || signatureHeader !== computedSignature) {
    return NextResponse.json({ error: 'Invalid or missing webhook signature' }, { status: 401 });
  }

  let product;
  try {
    product = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const processedImagesSrc = product.images.map((image: { src: string }) => ({ src: image.src }));

  const variableProductPayload = {
    name: product.name,
    type: 'variable',
    status: product.status,
    description: product.description,
    short_description: product.short_description,
    categories: product.categories,
    images: processedImagesSrc,
    attributes: product.attributes?.map((attr: any) => ({
      id: attr.id,
      name: attr.name,
      slug: attr.slug,
      position: attr.position || 0,
      visible: attr.visible ?? true,
      variation: attr.variation ?? true,
      options: attr.options
    })),
    meta_data: product.meta_data
  };

  try {
    // 1. Create the main variable product
    const productResponse = await axios.post(wcApiUrl, variableProductPayload, {
      auth: { username: consumerKey, password: consumerSecret },
      headers: { 'Content-Type': 'application/json' },
    });

    const productId = productResponse.data.id;
    const sizeAttribute = product.attributes?.find((attr: any) => attr.name.toLowerCase() === 'size');

    if (!sizeAttribute) {
      console.warn('No Size attribute found, skipping variation creation.');
    } else {
      const variationsEndpoint = `${wcApiUrl}/${productId}/variations`;

      // 2. Create each variation
      for (const size of sizeAttribute.options) {
        await axios.post(variationsEndpoint, {
          regular_price: product.regular_price ?? '0',
          attributes: [
            {
              id: sizeAttribute.id,
              option: size
            }
          ]
        }, {
          auth: { username: consumerKey, password: consumerSecret },
          headers: { 'Content-Type': 'application/json' },
        });
        console.log(`Variation created for size: ${size}`);
      }
    }

    return NextResponse.json({ success: true, productId, message: 'Product and variations created' });
  } catch (error) {
    const axiosError = error as AxiosError;
    return NextResponse.json({
      error: 'Failed to replicate product',
      details: axiosError.message,
      response: axiosError.response?.data
    }, { status: 500 });
  }
}