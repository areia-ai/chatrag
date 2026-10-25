import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { openRouter, getOpenRouterClient } from '@/lib/openrouter';

// Use Node.js runtime instead of Edge
export const runtime = 'nodejs';

// Check if web search is enabled at the application level
const isWebSearchEnabled = env.NEXT_PUBLIC_WEB_SEARCH_ENABLED === 'true';

export async function POST(req: Request) {
  try {
    // Check if web search is enabled
    if (!isWebSearchEnabled) {
      return NextResponse.json(
        { error: 'Web search is not enabled' },
        { status: 400 }
      );
    }

    // Parse the request body
    const { query, type } = await req.json();

    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Construct the appropriate query based on the type
    let searchQuery = query;
    
    if (type === 'weather') {
      searchQuery = `Current weather in ${query}. Include temperature, conditions, humidity, wind speed and direction.`;
    } else if (type === 'stock') {
      searchQuery = `Current stock price and information for ${query} ticker symbol. Include price, change, volume, market cap, PE ratio.`;
    }

    // Create a system message for the search
    const systemMessage = {
      role: 'system' as const,
      content: `You are a helpful assistant that provides accurate information based on web search results. 
      ${type === 'weather' ? 'Format your response as a JSON object with weather data.' : ''}
      ${type === 'stock' ? 'Format your response as a JSON object with stock data.' : ''}`
    };

    // Create a user message with the query
    const userMessage = {
      role: 'user' as const,
      content: searchQuery
    };

    // Configure request parameters
    const requestParams = {
      messages: [systemMessage, userMessage],
      model: 'anthropic/claude-3-haiku-20240307:online', // Use a model with web search capability
      stream: false as const, // Explicitly type as const false
      temperature: 0.2, // Lower temperature for more factual responses
      plugins: [
        {
          id: 'web',
          max_results: 5, // Default number of results to return
        }
      ]
    };

    console.log('Making web search request:', searchQuery);

    // Get the OpenRouter client and check if it's available
    const openRouterClient = getOpenRouterClient();
    if (!openRouterClient) {
      return NextResponse.json(
        { error: 'OpenRouter API not configured. Please check your environment variables.' },
        { status: 500 }
      );
    }

    // Make the request to OpenRouter
    const response = await openRouterClient.chat.completions.create(requestParams);

    // Extract the response content
    const content = response.choices[0]?.message?.content || '';

    // Process the response based on the type
    if (type === 'weather') {
      try {
        // Extract JSON data from the response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const jsonData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        
        if (!jsonData) {
          throw new Error('No valid JSON data found in response');
        }
        
        return NextResponse.json({ weatherData: jsonData });
      } catch (error) {
        console.error('Error parsing weather data:', error);
        return NextResponse.json(
          { error: 'Failed to parse weather data', content },
          { status: 500 }
        );
      }
    } else if (type === 'stock') {
      try {
        // Extract JSON data from the response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const jsonData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        
        if (!jsonData) {
          throw new Error('No valid JSON data found in response');
        }
        
        return NextResponse.json({ stockData: jsonData });
      } catch (error) {
        console.error('Error parsing stock data:', error);
        return NextResponse.json(
          { error: 'Failed to parse stock data', content },
          { status: 500 }
        );
      }
    } else {
      // For general web search, return the raw content
      return NextResponse.json({ content });
    }
  } catch (error: any) {
    console.error('Web search error:', error);
    return NextResponse.json(
      { error: error.message || 'An error occurred during web search' },
      { status: 500 }
    );
  }
} 