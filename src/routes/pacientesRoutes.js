// src/routes/pacientesRoutes.js
import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  crearPaciente,
  obtenerPacientesUsuario,
  claimPaciente,
  obtenerPacientesDeUsuario,
  actualizarPaciente,
  desvincularPaciente,
  obtenerPacientePorId
} from '../controllers/pacientesController.js';

const router = express.Router();

// Crear paciente y vincularlo al usuario autenticado
router.post('/', authMiddleware, crearPaciente);

// Listar pacientes del usuario autenticado
router.get('/', authMiddleware, obtenerPacientesUsuario);

// Reclamar paciente existente (asociar usuario como titular)
router.post('/:id_paciente/claim', authMiddleware, claimPaciente);

// Listar pacientes relacionados al usuario autenticado (alias de /)
router.get('/mios', authMiddleware, obtenerPacientesDeUsuario);

// Actualizar datos de un paciente específico
router.put('/:id_paciente', authMiddleware, actualizarPaciente);

// Desvincular paciente (eliminar relación paciente_usuario, no borrar paciente)
router.delete('/:id_paciente', authMiddleware, desvincularPaciente);

// Obtener datos de un paciente específico
router.get('/:id_paciente', authMiddleware, obtenerPacientePorId);

export default router;
