// src/routes/citasRoutes.js
import express from 'express';
import { crearCita, obtenerCitasPorPaciente, reprogramarCita } from '../controllers/citasController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * Crear nueva cita
 * POST /citas
 * Body esperado:
 * {
 *   "id_paciente": 4,
 *   "id_odontologo": 1,
 *   "fecha": "2025-09-25",
 *   "hora_inicio": "10:30:00",
 *   "tipo_cita": "normal" // opcional
 * }
 */
router.post('/', authMiddleware, crearCita);

/**
 * Obtener citas de un paciente
 * GET /citas/:id_paciente
 */
router.get('/:id_paciente', authMiddleware, obtenerCitasPorPaciente);

// Reprogramar cita
router.put('/:id_cita/reprogramar', authMiddleware, reprogramarCita);

export default router;
