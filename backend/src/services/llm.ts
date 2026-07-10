import OpenAI from 'openai';
import { generarRespuestaLocal } from './ollama'; // Importamos la nueva función local

const openai = new OpenAI({
    apiKey: process.env.PROVIDER_API_KEY
});

export async function generarRespuestaFinal(pregunta: string, contexto: string): Promise<string> {
    const proveedor = process.env.LLM_PROVIDER || 'openai'; // Por defecto usa openai si no hay variable

    if (proveedor === 'local') {
        // 🔀 RUTA 1: Procesamiento 100% Local (Costo Cero)
        console.log("🤖 [SWITCH] Generando respuesta con IA Local (Ollama)...");
        return await generarRespuestaLocal(pregunta, contexto);

    } else {
        // 🔀 RUTA 2: Procesamiento Híbrido (API de Pago)
        console.log("☁️ [SWITCH] Generando respuesta con API Comercial (OpenAI)...");

        const systemPrompt = `Eres un asistente técnico exclusivo para este proyecto.
    REGLAS ESTRICTAS DE NEGOCIO:
    1. Responde usando ÚNICAMENTE el contexto provisto.
    2. Si la respuesta exacta no está, responde: "No tengo suficiente información en la documentación del proyecto para responder eso."
    3. No asumas ni inventes datos técnicos.
    
    CONTEXTO DEL PROYECTO:
    ${contexto}`;

        const respuesta = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: pregunta }
            ],
            temperature: 0.0
        });

        return respuesta.choices[0].message.content || 'Error al procesar la respuesta.';
    }
}