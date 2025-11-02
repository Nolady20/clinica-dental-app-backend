// src/routes/citasRoutes.js

import express from 'express';
import {
  crearCita,
  obtenerCitasPorPaciente,
  reprogramarCita,
  obtenerFechasDisponibles,
  obtenerDoctores,
  obtenerHorariosPorOdontologo
} from '../controllers/citasController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

// ✅ Primero las rutas más específicas
router.get('/fechas-disponibles', authMiddleware, obtenerFechasDisponibles);
router.get('/doctores', authMiddleware, obtenerDoctores);
router.get('/doctores/:id/horarios', authMiddleware, obtenerHorariosPorOdontologo);

// Luego las rutas más generales
router.post('/', authMiddleware, crearCita);
router.get('/:id_paciente', authMiddleware, obtenerCitasPorPaciente);
router.put('/:id_cita/reprogramar', authMiddleware, reprogramarCita);

export default router;
