// src/routes/pacientesRoutes.js
import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { crearPaciente, obtenerPacientesUsuario} from '../controllers/pacientesController.js';
import { claimPaciente, obtenerPacientesDeUsuario } from '../controllers/pacientesController.js';

const router = express.Router();

router.post('/', authMiddleware, crearPaciente); // crear paciente y vincular
router.get('/', authMiddleware, obtenerPacientesUsuario); // listar pacientes del usuario

// Reclamar paciente (un usuario se asocia como titular de un paciente existente)
router.post('/:id_paciente/claim', authMiddleware, claimPaciente);

// Listar pacientes relacionados a un usuario autenticado
router.get('/mios', authMiddleware, obtenerPacientesDeUsuario);

export default router;
