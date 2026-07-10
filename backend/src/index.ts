import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { inicializarBaseDeDatos, guardarFragmento, buscarContextoSimilar } from './services/db';
import { generarEmbeddingLocal } from './services/ollama';
import { generarRespuestaFinal } from './services/llm';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Endpoint 1: Subir e Indexar el PDF del Proyecto
app.post('/upload', upload.single('file'), async (req, res): Promise<any> => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

        // 1. Extraer texto del buffer del PDF
        const datosPdf = await pdfParse(req.file.buffer);
        const textoCompleto = datosPdf.text;

        // 2. Fragmentación simple (Chunks de ~600 caracteres)
        const chunks = textoCompleto.match(/[\s\S]{1,600}/g) || [];

        // 3. Procesar y guardar cada fragmento localmente
        for (const chunk of chunks) {
            const textoLimpio = chunk.trim();
            if (textoLimpio.length > 10) {
                const embedding = await generarEmbeddingLocal(textoLimpio);
                await guardarFragmento(textoLimpio, embedding);
            }
        }

        return res.json({ mensaje: `PDF indexado correctamente en ${chunks.length} fragmentos vectoriales.` });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

// Endpoint 2: Chatbot con RAG Híbrido y Guardrails
app.post('/chat', async (req, res): Promise<any> => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'El mensaje es requerido' });

        // 1. Vectorizar la consulta del usuario usando Ollama local (A costo cero)
        const embeddingPregunta = await generarEmbeddingLocal(message);

        // 2. Recuperar los fragmentos más cercanos de la base de datos local
        const fragmentosContexto = await buscarContextoSimilar(embeddingPregunta, 3);

        if (fragmentosContexto.length === 0) {
            return res.json({ response: "No tengo suficiente información en la documentación del proyecto para responder eso." });
        }

        const contextoUnificado = fragmentosContexto.join('\n\n');

        // 3. Generar la respuesta final mandando el contexto consolidado al modelo de pago
        const respuestaAgente = await generarRespuestaFinal(message, contextoUnificado);

        return res.json({ response: respuestaAgente });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, async () => {
    await inicializarBaseDeDatos();
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});