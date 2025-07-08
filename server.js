const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Binance = require('binance-api-node').default;
const { RSI } = require('technicalindicators'); // Импортируем RSI

const app = express();
const PORT = 3000;
const JWT_SECRET = 'your-super-secret-key';
const ENCRYPTION_KEY = '12345678901234567890123456789012';

// ... функции шифрования, middleware, маршруты API ...

// ---------------------------------------------------
// ### ОСНОВНАЯ ЛОГИКА ТОРГОВОГО БОТА (V2) ###
// ---------------------------------------------------

async function runTradingLogic() {
    console.log(`\n🤖 [${new Date().toLocaleTimeString()}] Uruchamiam weryfikację handlową według RSI...`);

    const { rows: users } = await pool.query('SELECT * FROM users WHERE api_key_encrypted IS NOT NULL');
    if (users.length === 0) return;

    for (const user of users) {
        try {
            const apiKey = decrypt(JSON.parse(user.api_key_encrypted));
            const apiSecret = decrypt(JSON.parse(user.api_secret_encrypted));
            const userBinanceClient = Binance({ apiKey, apiSecret });

            // 1. Получаем исторические данные (100 последних часовых свечей) для расчета RSI
            const candles = await userBinanceClient.candles({
                symbol: 'BTCUSDT',
                interval: '1h', // Часовой интервал
                limit: 100      // Количество свечей
            });

            // 2. Готовим данные и считаем RSI
            const closingPrices = candles.map(candle => parseFloat(candle.close));
            const rsiResult = RSI.calculate({
                values: closingPrices,
                period: 14 // Стандартный период для RSI
            });
            const currentRSI = rsiResult[rsiResult.length - 1]; // Берем последнее значение RSI

            console.log(`- Sprawdzanie dla ${user.email}. Aktualny RSI(14) na 1h: ${currentRSI.toFixed(2)}`);

            // 3. НОВАЯ ТОРГОВАЯ СТРАТЕГИЯ НА ОСНОВЕ RSI
            if (currentRSI < 30) {
                console.log(`🔥 [${user.email}] RSI poniżej 30! Sygnał KUPNA! Składam zlecenie...`);
                const order = await userBinanceClient.order({
                    symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: '15',
                });
                console.log(`✅ Zlecenie SPRZEDAŻY dla ${user.email} Złożono pomyślnie!`, order);

            } else if (currentRSI > 70) {
                console.log(`📉 [${user.email}] RSI powyżej 70! Sygnał SPRZEDAŻY! Składam zlecenie...`);
                const order = await userBinanceClient.order({
                    symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: '0.0002', // Продаем небольшое кол-во BTC для примера
                });
                console.log(`✅ Zlecenie SPRZEDAŻY dla ${user.email} Złożono pomyślnie!`, order);
            
            } else {
                console.log(`- [${user.email}] Neutralna strefa RSI. Nic nie robimy.`);
            }

        } catch (error) {
            console.error(`❌ Błąd przy przetwarzaniu użytkownika. ${user.email}:`, error.body || error);
        }
    }
}

function startBot() {
    console.log('🚀 Bot v2 (RSI) uruchomiony! Logika będzie wykonywana co minutę...');
    runTradingLogic();
    setInterval(runTradingLogic, 60000);
}

// ... остальной код сервера ...
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});
app.use(express.json()); app.use(express.static(path.join(__dirname, 'public')));
function encrypt(text) { const iv = crypto.randomBytes(16); const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf-8'), iv); let e = cipher.update(text); e = Buffer.concat([e, cipher.final()]); return { iv: iv.toString('hex'), encryptedData: e.toString('hex') }; }
function decrypt(text) { const iv = Buffer.from(text.iv, 'hex'); const e = Buffer.from(text.encryptedData, 'hex'); const d = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf-8'), iv); let dr = d.update(e); dr = Buffer.concat([dr, d.final()]); return dr.toString(); }
function authenticateToken(req, res, next) { const authHeader = req.headers['authorization']; const token = authHeader && authHeader.split(' ')[1]; if (token == null) return res.sendStatus(401); jwt.verify(token, JWT_SECRET, (err, user) => { if (err) return res.sendStatus(403); req.user = user; next(); }); }
app.post('/api/register', async (req, res) => { try { const { email, password } = req.body; const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]); if (existingUser.rows.length > 0) return res.status(409).json({ message: 'Пользователь уже существует' }); const passwordHash = await bcrypt.hash(password, 10); const newUser = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email', [email, passwordHash]); console.log('✅ Пользователь сохранен:', newUser.rows[0]); res.status(201).json({ message: `Пользователь ${newUser.rows[0].email} зарегистрирован!` }); } catch (error) { console.error('❌ Ошибка регистрации:', error); res.status(500).json({ message: 'Ошибка сервера' }); } });
app.post('/api/login', async (req, res) => { try { const { email, password } = req.body; const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]); if (userResult.rows.length === 0) return res.status(401).json({ message: 'Неверный email или пароль' }); const user = userResult.rows[0]; const isPasswordCorrect = await bcrypt.compare(password, user.password_hash); if (!isPasswordCorrect) return res.status(401).json({ message: 'Неверный email или пароль' }); const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' }); console.log(`✅ Пользователь ${user.email} успешно вошел в систему.`); res.json({ message: 'Вход успешен!', token: token }); } catch (error) { console.error('❌ Ошибка входа:', error); res.status(500).json({ message: 'Ошибка сервера' }); } });
app.post('/api/keys', authenticateToken, async (req, res) => { try { const { apiKey, apiSecret } = req.body; const userId = req.user.userId; const encryptedKey = encrypt(apiKey); const encryptedSecret = encrypt(apiSecret); await pool.query('UPDATE users SET api_key_encrypted = $1, api_secret_encrypted = $2 WHERE id = $3', [JSON.stringify(encryptedKey), JSON.stringify(encryptedSecret), userId]); console.log(`✅ API-ключи для пользователя ${req.user.email} сохранены.`); res.json({ message: 'API-ключи успешно сохранены' }); } catch (error) { console.error('❌ Ошибка сохранения ключей:', error); res.status(500).json({ message: 'Ошибка сервера' }); } });
app.get('/api/balance', authenticateToken, async (req, res) => { try { const userId = req.user.userId; const result = await pool.query('SELECT api_key_encrypted, api_secret_encrypted FROM users WHERE id = $1', [userId]); const keys = result.rows[0]; if (!keys.api_key_encrypted || !keys.api_secret_encrypted) return res.status(400).json({ message: 'API-ключи не найдены.' }); const apiKey = decrypt(JSON.parse(keys.api_key_encrypted)); const apiSecret = decrypt(JSON.parse(keys.api_secret_encrypted)); const client = Binance({ apiKey, apiSecret }); const accountInfo = await client.accountInfo(); const balances = accountInfo.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0); console.log(`✅ Баланс для пользователя ${req.user.email} успешно получен.`); res.json(balances); } catch (error) { console.error('❌ Ошибка получения баланса:', error.body || error); res.status(500).json({ message: 'Ошибка получения баланса. Проверьте API-ключи.' }); } });
app.get('/api/profile', authenticateToken, (req, res) => { console.log(`✅ Пользователь ${req.user.email} запросил свой профиль.`); res.json({ message: 'Добро пожаловать в ваш профиль!', userData: req.user }); });

app.listen(PORT, () => {
    console.log(`Serwer działa na http://localhost:${PORT}`);
    startBot();
});
