// src/routes/authRoutes.js
import express from 'express';
import { register, login, me } from '../controllers/authController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Registro y login
router.post('/register', register);
router.post('/login', login);

// Perfil del usuario autenticado
router.get('/me', authMiddleware, me);

export default router;
