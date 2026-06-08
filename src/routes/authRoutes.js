// src/routes/authRoutes.js
const express = require('express');
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();

// 🟢 NOVA ROTA DE CADASTRO (Delegada para o Controller que atende todas as Regras de Negócio)
router.post('/register', userController.registerUser);

// NOVA ROTA: Endpoint de Ativação (Recebe o token pela URL)
router.get('/activate/:token', userController.activateAccount);

// NOVA ROTA: Reenvio de Ativação
router.post('/resend-activation', userController.resendActivation);

// NOVA ROTA: Login
router.post('/login', userController.loginUser);

// NOVA ROTA: Logout
router.post('/logout', authMiddleware, userController.logoutUser);

// Consulta da sessao atual
router.get('/me', authMiddleware, userController.getUserProfile);

module.exports = router;
