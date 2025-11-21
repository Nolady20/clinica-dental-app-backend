// src/routes/tratamientosRoutes.js
import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  obtenerTratamientos,
  obtenerTratamientoPorId
} from '../controllers/tratamientosController.js';

const router = express.Router();

// 📌 El paciente SOLO puede consultar
router.get('/', authMiddleware, obtenerTratamientos);
router.get('/:id', authMiddleware, obtenerTratamientoPorId);

export default router;
