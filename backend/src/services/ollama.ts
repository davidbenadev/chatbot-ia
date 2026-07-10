import axios from 'axios';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

export async function generarEmbeddingLocal(texto: string): Promise<number[]> {
    try {
        const respuesta = await axios.post(`${OLLAMA_HOST}/api/embeddings`, {
            model: 'nomic-embed-text',
            prompt: texto
        });
        return respuesta.data.embedding;
    } catch (error) {
        console.error('Error al generar embedding en Ollama:', error);
        throw error;
    }
}

export async function generarRespuestaLocal(pregunta: string, contexto: string): Promise<string> {
    const systemPrompt = `Eres un asistente técnico exclusivo para este proyecto.
REGLAS ESTRICTAS:
1. Responde a la pregunta del usuario utilizando ÚNICAMENTE el contexto provisto.
2. Si la respuesta no está en el contexto, responde: "No tengo suficiente información en la documentación del proyecto para responder eso."
3. No inventes información.`;

    try {
        const respuesta = await axios.post(`${OLLAMA_HOST}/api/generate`, {
            model: 'llama3', // El modelo local generativo que usaremos
            prompt: `${systemPrompt}\n\nContexto:\n${contexto}\n\nPregunta:\n${pregunta}`,
            stream: false
        });
        return respuesta.data.response;
    } catch (error) {
        console.error('Error al generar respuesta local con Ollama:', error);
        throw error;
    }
}