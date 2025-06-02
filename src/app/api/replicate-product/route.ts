import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import axios, { AxiosError } from 'axios';

async function uploadImageToWooCommerce(imageUrl: string, consumerKey: string, consumerSecret: string, wcApiUrl: string) {
  try {
    console.log('Attempting to download image from:', imageUrl);
    
    // Download the image
    const imageResponse = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const imageBuffer = Buffer.from(imageResponse.data);
    
    // Construct the media endpoint URL
    const baseUrl = wcApiUrl.split('/wp-json/')[0];
    const mediaEndpoint = `${baseUrl}/wp-json/wp/v2/media`;
    console.log('Uploading to media endpoint:', mediaEndpoint);
    
    // Create form data for the upload
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer]), 'image.jpg');
    
    // Upload to WooCommerce media library
    const uploadResponse = await axios.post(
      mediaEndpoint,
      formData,
      {
        auth: {
          username: consumerKey,
          password: consumerSecret,
        },
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    
    console.log('Successfully uploaded image:', {
      status: uploadResponse.status,
      data: uploadResponse.data
    });
    
    return uploadResponse.data.id;
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error('Failed to upload image:', {
      imageUrl,
      error: axiosError.message,
      response: axiosError.response?.data,
      status: axiosError.response?.status,
      config: {
        url: axiosError.config?.url,
        method: axiosError.config?.method,
        headers: axiosError.config?.headers
      }
    });
    return null;
  }
}

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

  // Check if this is a test request
  const contentType = req.headers.get('content-type');
  const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
  
  if (contentType === 'application/x-www-form-urlencoded' && contentLength < 100) {
    console.log('Received test request');
    return NextResponse.json({ 
      status: 'ok',
      message: 'Test request received successfully',
      headers: headers
    });
  }

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

  let cleanProduct;
  try {
    console.log('Processing product images...');
    
    // Process images first
    const processedImages = [];
    if (product.images && Array.isArray(product.images)) {
      for (const image of product.images) {
        if (image.src) {
          console.log('Processing image:', image.src);
          const newImageId = await uploadImageToWooCommerce(
            image.src,
            consumerKey,
            consumerSecret,
            wcApiUrl
          );
          if (newImageId) {
            processedImages.push({ id: newImageId });
            console.log('Successfully processed image, new ID:', newImageId);
          } else {
            console.warn('Failed to process image:', image.src);
          }
        }
      }
    }

    // Clean up the product data before sending
    cleanProduct = {
      name: product.name,
      type: product.type,
      status: product.status,
      description: product.description,
      short_description: product.short_description,
      price: product.price,
      regular_price: product.regular_price,
      sale_price: product.sale_price,
      categories: product.categories,
      images: processedImages,
      attributes: product.attributes,
      variations: product.variations,
      meta_data: product.meta_data
    };

    // If no images were successfully processed, try to create the product without images
    if (processedImages.length === 0) {
      console.warn('No images were successfully processed, creating product without images');
    }

    console.log('Sending product data:', JSON.stringify(cleanProduct, null, 2));

    const response = await axios.post(wcApiUrl, cleanProduct, {
      auth: {
        username: consumerKey,
        password: consumerSecret,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log('Successfully created product, response:', {
      status: response.status,
      data: response.data
    });

    return NextResponse.json({ 
      success: true, 
      productId: response.data.id,
      message: 'Product created successfully',
      imagesProcessed: processedImages.length
    });
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error('Failed to replicate product:', {
      message: axiosError.message,
      response: axiosError.response?.data,
      status: axiosError.response?.status,
      requestData: cleanProduct
    });
    return NextResponse.json({ 
      error: 'Failed to replicate product', 
      details: axiosError.message,
      response: axiosError.response?.data,
      requestData: cleanProduct
    }, { status: 500 });
  }
}
