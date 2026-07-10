import { Pool } from 'pg';
import pdfParse from 'pdf-parse';
import axios from 'axios';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Inicializar la tabla de vectores al arrancar
export async function inicializarBaseDeDatos() {
    const cliente = await pool.connect();
    try {
        await cliente.query('CREATE EXTENSION IF NOT EXISTS vector;');
        await cliente.query(`
      CREATE TABLE IF NOT EXISTS documentos_conocimiento (
        id SERIAL PRIMARY KEY,
        contenido TEXT NOT NULL,
        embedding vector(768) NOT NULL
      );
    `);
        // Crear índice HNSW para búsqueda ultrarrápida ( cosine similarity)
        await cliente.query("CREATE INDEX ON documentos_conocimiento USING hnsw (embedding vector_cosine_ops);");
    } finally {
        cliente.release();
    }
}

export async function guardarFragmento(contenido: string, embedding: number[]) {
    // Formatear el array de números al formato string de pgvector: '[0.1,0.2,...]'
    const vectorStr = `[${embedding.join(',')}]`;
    await pool.query(
        'INSERT INTO documentos_conocimiento (contenido, embedding) VALUES ($1, $2)',
        [contenido, vectorStr]
    );
}

export async function buscarContextoSimilar(
    embeddingPregunta: number[],
    limite = 3,
    umbralDistancia = 0.5 // <-- El guardrail matemático (ajustable)
): Promise<string[]> {
    const vectorStr = `[${embeddingPregunta.join(',')}]`;

    // El operador <=> calcula la "Distancia del Coseno". 
    // 0.0 significa que los textos son idénticos.
    // Valores más altos significan que los textos no tienen nada que ver.
    const query = `
    SELECT contenido, (embedding <=> $1) as distancia
    FROM documentos_conocimiento 
    WHERE (embedding <=> $1) < $3
    ORDER BY embedding <=> $1 
    LIMIT $2;
  `;

    // Pasamos el umbral como el parámetro $3
    const resultado = await pool.query(query, [vectorStr, limite, umbralDistancia]);

    // (Opcional) Debug visual en tu terminal para ayudarte a calibrar
    if (resultado.rows.length === 0) {
        console.log("⚠️ Búsqueda bloqueada: La pregunta está fuera de los límites del proyecto.");
    } else {
        resultado.rows.forEach((row, index) => {
            console.log(`[Match ${index + 1}] Distancia: ${row.distancia}`);
        });
    }

    // Devolvemos solo el texto de los fragmentos que pasaron el filtro
    return resultado.rows.map(row => row.contenido);
}

export async function procesarYGuardarDocumento(pdfBuffer: Buffer, nombreArchivo: string) {
    // 1. Extraer texto crudo del PDF
    const datosPdf = await pdfParse(pdfBuffer);
    let textoCompleto = datosPdf.text;

    // 2. Limpieza básica (quitar saltos de línea excesivos)
    textoCompleto = textoCompleto.replace(/\n+/g, ' ').trim();

    // 3. Estrategia de Chunking (Superposición/Overlap)
    // Es vital superponer los fragmentos para no cortar ideas por la mitad.
    const tamanoFragmento = 800; // Caracteres
    const superposicion = 100;
    const chunks: string[] = [];

    for (let i = 0; i < textoCompleto.length; i += (tamanoFragmento - superposicion)) {
        const chunk = textoCompleto.substring(i, i + tamanoFragmento);
        if (chunk.length > 50) { // Ignorar fragmentos muy pequeños
            chunks.push(chunk);
        }
    }

    console.log(`Mapeando ${chunks.length} fragmentos a la base de datos...`);

    // 4. Mapeo e Inserción (Usando transacciones para seguridad)
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN'); // Iniciar transacción

        for (const chunk of chunks) {
            // Llamada a tu contenedor Ollama local para generar el vector
            const vectorRes = await axios.post(`http://localhost:11434/api/embeddings`, {
                model: 'nomic-embed-text',
                prompt: chunk
            });
            const vectorData = vectorRes.data.embedding;

            // Formatear a string de pgvector
            const vectorStr = `[${vectorData.join(',')}]`;

            // Insertar en la tabla mapeada
            await cliente.query(
                `INSERT INTO documentos_conocimiento (origen, contenido, embedding) 
         VALUES ($1, $2, $3)`,
                [nombreArchivo, chunk, vectorStr]
            );
        }

        await cliente.query('COMMIT'); // Guardar cambios si todo salió bien
        console.log('Mapeo de datos completado exitosamente.');

    } catch (error) {
        await cliente.query('ROLLBACK'); // Revertir si hubo un error a la mitad
        console.error('Error durante el mapeo a la DB:', error);
        throw error;
    } finally {
        cliente.release();
    }
}