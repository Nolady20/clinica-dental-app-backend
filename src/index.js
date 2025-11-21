// src/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/authRoutes.js';
import citasRoutes from './routes/citasRoutes.js';
import pacientesRoutes from './routes/pacientesRoutes.js';
import tratamientosRoutes from './routes/tratamientosRoutes.js';


dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('SAIDENT backend OK'));

// Agrupamos rutas
app.use('/auth', authRoutes);
app.use('/citas', citasRoutes);
app.use('/pacientes', pacientesRoutes);
app.use('/tratamientos', tratamientosRoutes);



app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server corriendo en http://0.0.0.0:${PORT}`);
});
