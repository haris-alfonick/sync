import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import axios, { AxiosError } from 'axios';

export async function POST(req: NextRequest) {
  console.log('Webhook received at:', new Date().toISOString());
  
  // Log all headers for debugging
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  console.log('All received headers:', headers);
  
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

  // Get signature header case-insensitively
  const signatureHeader = req.headers.get('x-wc-webhook-signature') || 
                         req.headers.get('X-WC-Webhook-Signature');
  console.log('Received signature header:', signatureHeader);
  
  const rawBody = await req.text();
  console.log('Received raw body:', rawBody);
  console.log('Received raw body length:', rawBody.length);

  // Verify webhook signature
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  
  console.log('Signature verification details:', {
    receivedSignature: signatureHeader,
    computedSignature: computedSignature,
    secretLength: secret.length,
    rawBodyLength: rawBody.length,
    contentType: req.headers.get('content-type'),
    webhookId: req.headers.get('x-wc-webhook-id'),
    webhookTopic: req.headers.get('x-wc-webhook-topic'),
    webhookEvent: req.headers.get('x-wc-webhook-event')
  });

  if (!signatureHeader) {
    console.error('No signature header received. Please check WooCommerce webhook configuration.');
    return NextResponse.json({ 
      error: 'Missing webhook signature header',
      details: 'The X-WC-Webhook-Signature header was not received. Please check your WooCommerce webhook configuration.',
      headers: headers
    }, { status: 401 });
  }

  if (signatureHeader !== computedSignature) {
    console.error('Signature mismatch:', {
      received: signatureHeader,
      computed: computedSignature,
      secretLength: secret.length,
      headers: headers,
      rawBody: rawBody
    });
    return NextResponse.json({ 
      error: 'Invalid webhook signature',
      details: 'The webhook signature does not match. Please verify your webhook secret in both WooCommerce and your environment variables.',
      headers: headers,
      debug: {
        receivedSignature: signatureHeader,
        computedSignature: computedSignature,
        secretLength: secret.length,
        rawBodyLength: rawBody.length
      }
    }, { status: 401 });
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
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error('Failed to replicate product:', {
      message: axiosError.message,
      response: axiosError.response?.data,
      status: axiosError.response?.status
    });
    return NextResponse.json({ 
      error: 'Failed to replicate product', 
      details: axiosError.message,
      response: axiosError.response?.data 
    }, { status: 500 });
  }
}
