// src/routes/authRoutes.js
import express from 'express';
import { 
  register, 
  login, 
  me,
  resetPassword,
  verifyOtpAndChangePassword,
  actualizarPerfilUsuario,
  cambiarCorreo,
  cambiarPassword,
  eliminarCuenta
} from '../controllers/authController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Registro y login
router.post('/register', register);
router.post('/login', login);

// Perfil del usuario autenticado
router.get('/me', authMiddleware, me);

router.post("/reset-password", resetPassword);            // Enviar OTP
router.post("/verify-otp", verifyOtpAndChangePassword);   // Verificar OTP y cambiar pass
router.put("/update-profile", authMiddleware, actualizarPerfilUsuario);
router.put("/change-email", authMiddleware, cambiarCorreo);
router.put("/change-password", authMiddleware, cambiarPassword);
router.put("/delete-account", authMiddleware, eliminarCuenta);


export default router;
