import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import axios from 'axios';

export async function POST(req: NextRequest) {
  console.log('Webhook received at:', new Date().toISOString());
  
  const secret = process.env.WEBHOOK_SECRET!;
  const consumerKey = process.env.WC2_CONSUMER_KEY!;
  const consumerSecret = process.env.WC2_CONSUMER_SECRET!;
  const wcApiUrl = process.env.WC2_API_URL!; // e.g. https://yourwebsite2.com/wp-json/wc/v3/products

  console.log('Environment check:', {
    hasSecret: !!secret,
    hasConsumerKey: !!consumerKey,
    hasConsumerSecret: !!consumerSecret,
    hasWcApiUrl: !!wcApiUrl,
    wcApiUrl
  });

  const signatureHeader = req.headers.get('x-wc-webhook-signature');
  console.log('Received signature header:', signatureHeader);
  
  const rawBody = await req.text();
  console.log('Received raw body length:', rawBody.length);

  // Verify webhook signature
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  
  console.log('Computed signature:', computedSignature);

  if (signatureHeader !== computedSignature) {
    console.error('Signature mismatch:', {
      received: signatureHeader,
      computed: computedSignature
    });
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  let product;
  try {
    product = JSON.parse(rawBody);
    console.log('Successfully parsed product data');
  } catch (error) {
    console.error('Failed to parse JSON:', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Optional: map or transform the product before forwarding
  try {
    console.log('Attempting to forward product to:', wcApiUrl);
    const response = await axios.post(wcApiUrl, product, {
      auth: {
        username: consumerKey,
        password: consumerSecret,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log('Successfully forwarded product, response:', response.status);
    return NextResponse.json({ success: true, productId: response.data.id });
  } catch (error: any) {
    console.error('Failed to replicate product:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    return NextResponse.json({ 
      error: 'Failed to replicate product', 
      details: error.message,
      response: error.response?.data 
    }, { status: 500 });
  }
}
