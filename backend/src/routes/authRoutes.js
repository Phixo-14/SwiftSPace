const express = require('express');
const Joi = require('joi');
const { registrationStatus, saveFirebaseRegistrationIntent, validateInitialAdminSetup, setupInitialAdmin, register, login, adminLogin, firebaseSync, deleteFirebaseUser, deleteAccount, syncFirebaseUsers, createAdmin, banUser, verifyEmail, resendVerification, resendFirebaseVerificationLink, getAdminOverview, startMfaSetup, verifyMfaSetup, disableMfa, verifyMfaLogin } = require('../controllers/authController');
const { getSystemLogs } = require('../controllers/systemLogController');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateBody, publicRegisterSchema, loginSchema, verificationSchema, emailSchema, firebaseVerificationLinkSchema, firebaseSyncSchema, firebaseRegistrationIntentSchema, initialAdminSetupSchema, initialAdminSetupTokenSchema, firebaseDeleteSchema, accountDeleteSchema, adminSchema, mfaSchema } = require('../middleware/validators');
const { loginLimiter, verificationEmailLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.get('/registration-status', registrationStatus);
router.post('/firebase-registration-intent', validateBody(firebaseRegistrationIntentSchema), saveFirebaseRegistrationIntent);
router.post('/initial-admin-setup/validate', validateBody(initialAdminSetupTokenSchema), validateInitialAdminSetup);
router.post('/initial-admin-setup', validateBody(initialAdminSetupSchema), setupInitialAdmin);
router.post('/register', validateBody(publicRegisterSchema), register);
router.post('/login', loginLimiter, validateBody(loginSchema), login);
router.post('/login/mfa', loginLimiter, validateBody(loginSchema.keys({ code: Joi.string().pattern(/^\d{6}$/).required() })), verifyMfaLogin);
router.post('/admin-login', loginLimiter, validateBody(loginSchema), adminLogin);
router.post('/firebase-sync', validateBody(firebaseSyncSchema), firebaseSync);
router.post('/firebase/resend-verification-link', verificationEmailLimiter, validateBody(firebaseVerificationLinkSchema), resendFirebaseVerificationLink);
router.post('/firebase-user-deleted', validateBody(firebaseDeleteSchema), deleteFirebaseUser);
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
router.delete('/account', requireAuth, validateBody(accountDeleteSchema), deleteAccount);
router.post('/admin/sync-firebase-users', requireAuth, requireAdmin, syncFirebaseUsers);
router.post('/verify-email', validateBody(verificationSchema), verifyEmail);
router.post('/resend-verification', validateBody(emailSchema), resendVerification);
router.post('/mfa/setup', requireAuth, validateBody(mfaSchema), startMfaSetup);
router.post('/mfa/verify', requireAuth, validateBody(mfaSchema), verifyMfaSetup);
router.post('/mfa/disable', requireAuth, validateBody(mfaSchema), disableMfa);
router.post('/admins', requireAuth, requireAdmin, validateBody(adminSchema), createAdmin);
router.patch('/users/:id/ban', requireAuth, requireAdmin, validateBody(Joi.object({ banned: Joi.boolean().required() })), banUser);
router.get('/admin/overview', requireAuth, requireAdmin, getAdminOverview);
router.get('/admin/logs', requireAuth, requireAdmin, getSystemLogs);

module.exports = router;
