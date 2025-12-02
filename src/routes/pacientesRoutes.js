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
  obtenerPacientePorId,
  actualizarPerfilTitular,
  obtenerPerfilTitular,
  cambiarCorreo,
  cambiarContrasena
} from '../controllers/pacientesController.js';

const router = express.Router();

// ======================================================
// 🔹 RUTAS FIJAS DEL PERFIL DEL TITULAR  (DEBEN IR ARRIBA)
// ======================================================

router.get('/perfil/titular', authMiddleware, obtenerPerfilTitular);
router.put('/perfil/titular', authMiddleware, actualizarPerfilTitular);

// ======================================================
// 🔹 RUTAS GENERALES
// ======================================================

router.post('/', authMiddleware, crearPaciente);
router.get('/', authMiddleware, obtenerPacientesUsuario);
router.post('/:id_paciente/claim', authMiddleware, claimPaciente);
router.get('/mios', authMiddleware, obtenerPacientesDeUsuario);
router.put('/:id_paciente', authMiddleware, actualizarPaciente);
router.delete('/:id_paciente', authMiddleware, desvincularPaciente);
router.get('/:id_paciente', authMiddleware, obtenerPacientePorId);
router.put('/perfil/correo', authMiddleware, cambiarCorreo);
router.put('/perfil/password', authMiddleware, cambiarContrasena);

export default router;
