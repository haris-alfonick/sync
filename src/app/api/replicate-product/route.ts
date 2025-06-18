import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import axios, { AxiosError } from 'axios';

interface WCProductAttribute {
  id: number;
  name: string;
  slug: string;
  position?: number;
  visible?: boolean;
  variation?: boolean;
  options: string[];
}

export async function POST(req: NextRequest) {
  console.log('✅ Webhook received at:', new Date().toISOString());

  const secret = process.env.WEBHOOK_SECRET!;
  const consumerKey = process.env.WC2_CONSUMER_KEY!;
  const consumerSecret = process.env.WC2_CONSUMER_SECRET!;
  const wcApiUrl = process.env.WC2_API_URL!;

  const signatureHeader = req.headers.get('x-wc-webhook-signature') || req.headers.get('X-WC-Webhook-Signature');
  const rawBody = await req.text();
  const computedSignature = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');

  if (!signatureHeader || signatureHeader !== computedSignature) {
    console.error('❌ Invalid webhook signature');
    return NextResponse.json({ error: 'Invalid or missing webhook signature' }, { status: 401 });
  }

  let product;
  try {
    product = JSON.parse(rawBody);
  } catch (err) {
    console.error('❌ Invalid JSON body:', err);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const originId = product.meta_data?.find((meta: any) => meta.key === 'origin_id')?.value;
  if (!originId) {
    console.error('❌ Missing origin_id in meta_data');
    return NextResponse.json({ error: 'Missing origin_id in meta_data' }, { status: 400 });
  }

  console.log(`🔎 Checking for existing product with origin_id: ${originId}`);

  // Check if a product already exists with this origin_id
  try {
    const existingProductResponse = await axios.get(`${wcApiUrl}?meta_key=origin_id&meta_value=${originId}`, {
      auth: { username: consumerKey, password: consumerSecret },
    });

    const existingProducts = existingProductResponse.data;
    if (existingProducts.length > 0) {
      console.log(`⚠️ Product with origin_id ${originId} already exists (ID: ${existingProducts[0].id}), skipping creation.`);
      return NextResponse.json({ message: 'Product already exists. Skipping creation.', productId: existingProducts[0].id });
    }
  } catch (checkError) {
    console.error('❌ Failed to check existing products:', checkError);
    return NextResponse.json({ error: 'Failed to verify existing products' }, { status: 500 });
  }

  const processedImagesSrc = product.images.map((image: { src: string }) => ({ src: image.src }));

  const variableProductPayload = {
    name: product.name,
    type: 'variable',
    status: 'draft', // Always draft
    description: product.description,
    short_description: product.short_description,
    categories: product.categories,
    images: processedImagesSrc,
    attributes: (product.attributes as WCProductAttribute[])?.map(attr => ({
      id: attr.id,
      name: attr.name,
      slug: attr.slug,
      position: attr.position || 0,
      visible: attr.visible ?? true,
      variation: attr.variation ?? true,
      options: attr.options,
    })),
    meta_data: [
      ...product.meta_data, // keep existing meta
      { key: 'origin_id', value: originId }, // ensure origin_id is included
    ],
  };

  try {
    const productResponse = await axios.post(wcApiUrl, variableProductPayload, {
      auth: { username: consumerKey, password: consumerSecret },
      headers: { 'Content-Type': 'application/json' },
    });

    const productId = productResponse.data.id;
    console.log(`✅ Product created: ${product.name} (ID: ${productId})`);

    const sizeAttribute = (product.attributes as WCProductAttribute[])?.find(attr => attr.name.toLowerCase() === 'size');

    if (!sizeAttribute) {
      console.warn('⚠️ No Size attribute found. Skipping variation creation.');
    } else {
      const variationsEndpoint = `${wcApiUrl}/${productId}/variations`;
      const basePrice = parseFloat(product.price);
      const baseRegularPrice = basePrice + 40;

      for (const size of sizeAttribute.options) {
        let regularPrice = baseRegularPrice;
        let salePrice = basePrice;

        if (['Custom Size (+40)', 'Custom Size (+$40)'].includes(size)) {
          regularPrice += 40;
          salePrice = baseRegularPrice;
        }

        const variationData = {
          regular_price: regularPrice.toFixed(2),
          sale_price: salePrice.toFixed(2),
          attributes: [
            {
              id: sizeAttribute.id,
              option: size,
            },
          ],
        };

        try {
          const variationResponse = await axios.post(variationsEndpoint, variationData, {
            auth: { username: consumerKey, password: consumerSecret },
            headers: { 'Content-Type': 'application/json' },
          });
          console.log(`✅ Variation created for size: ${size} (ID: ${variationResponse.data.id})`);
        } catch (variationError) {
          console.error(`❌ Failed to create variation for size "${size}":`, variationError);
        }
      }
    }

    return NextResponse.json({ success: true, productId, message: 'Product and variations created' });
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error('❌ Failed to create product:', axiosError.message, axiosError.response?.data);
    return NextResponse.json({
      error: 'Failed to replicate product',
      details: axiosError.message,
      response: axiosError.response?.data,
    }, { status: 500 });
  }
}