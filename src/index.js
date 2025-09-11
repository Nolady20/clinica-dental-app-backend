// src/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { register, login, me } from './controllers/authController.js';
import { authMiddleware } from './middlewares/authMiddleware.js'; // 👈 importamos el middleware

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

// CORS: en desarrollo puedes permitir todo; en producción restringe a tu dominio
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('SAIDENT backend OK'));

// Auth routes
app.post('/register', register);        // crea usuario en Auth y en public.usuarios
app.post('/login', login);              // login por DNI -> devuelve session
app.get('/me', authMiddleware, me);     // 👈 ahora esta ruta valida el token primero

app.get('/ping', (req, res) => {
  res.json({ message: "pong" });
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server corriendo en http://0.0.0.0:${PORT}`);
});

