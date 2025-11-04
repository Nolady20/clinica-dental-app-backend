// src/routes/citasRoutes.js
import express from 'express';
import {
  crearCita,
  obtenerCitasPorPaciente,
  reprogramarCita,
  obtenerFechasDisponibles,
  obtenerDoctores,
  obtenerHorariosPorOdontologo,
  obtenerCitasPorUsuario
} from '../controllers/citasController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

// ✅ Rutas específicas primero
router.get('/fechas-disponibles', authMiddleware, obtenerFechasDisponibles);
router.get('/doctores', authMiddleware, obtenerDoctores);
router.get('/doctores/:id/horarios', authMiddleware, obtenerHorariosPorOdontologo);

// ✅ Rutas generales
router.post('/', authMiddleware, crearCita);
router.get('/usuario/:id_usuario', authMiddleware, obtenerCitasPorUsuario);
router.get('/:id_paciente', authMiddleware, obtenerCitasPorPaciente);
router.put('/:id_cita/reprogramar', authMiddleware, reprogramarCita);

export default router;
