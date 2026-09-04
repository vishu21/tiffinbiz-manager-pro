import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text) {
      return Response.json({ error: 'Text input is required' }, { status: 400 });
    }

    // Call Google Gemini 2.5 Flash for structured extraction (100% Free Tier)
    const { object } = await generateObject({
      model: google('gemini-2.5-flash'), 
      schema: z.object({
        meal_type: z.string().describe('Meal classification like veg, non-veg, eggitarian, vegan.'),
        portion_size: z.string().describe('Portion sizing mentioned like small, medium, large, standard.'),
        roti_count: z.number().nullable().describe('The number of rotis explicitly requested as an integer.'),
        rice_count: z.string().describe('The description or quantity of rice specified.'),
        delivery_schedule: z.string().describe('The active delivery day framework matching input e.g. Monday to Friday.'),
      }),
      prompt: `Analyze the following tiffin dietary track request notes and extract the component values cleanly: "${text}"`,
    });

    return Response.json(object);
  } catch (error: any) {
    console.error('Gemini Parsing Error:', error);
    
    return Response.json({ 
      error: 'AI parsing failed. Please verify your Gemini API key configurations.',
      details: error.message 
    }, { status: 200 }); 
  }
}