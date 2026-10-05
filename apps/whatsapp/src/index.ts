import express from 'express';
import cors from 'cors';
import whatsappRouter from './whatsappRoute';

const app = express();
const PORT = process.env.WHATSAPP_PORT || 3010;

app.use(cors());
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
  },
}));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'whatsapp', ts: new Date().toISOString() }));
app.use('/', whatsappRouter);

app.listen(PORT, () => {
  console.log(`📱 WhatsApp service running on http://localhost:${PORT}`);
});
