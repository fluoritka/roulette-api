const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// СЮДА ВСТАВЬ ID СВОЕЙ ТАБЛИЦЫ
const SHEET_ID = "1EzLQpw13NtoJK2EEXRmRsezRvz3sAOOC_DXNFvXcQyw";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

// 1. Получаем список призов и шансов
async function getPrizes() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'prizes!A2:B' // Лист с шансами
  });
  return res.data.values.map(r => ({ name: r[0], chance: Number(r[1]) }));
}

// 2. Рандом по весам
function weightedRandom(prizes) {
  const total = prizes.reduce((sum, p) => sum + p.chance, 0);
  let rand = Math.random() * total;
  for (let p of prizes) {
    if (rand < p.chance) return p;
    rand -= p.chance;
  }
}

// 3. Эндпоинт для получения списка (для отрисовки колеса)
app.get('/get_prizes_list', async (req, res) => {
  try {
    const prizes = await getPrizes();
    res.json({ names: prizes.map(p => p.name) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. ГЛАВНАЯ ЛОГИКА: КРУТКА
app.post('/spin', async (req, res) => {
  const { code, nickname } = req.body;

  try {
    // Получаем все ключи (Лист "keys", колонки A, B, C, D)
    const codesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'keys!A2:D' 
    });

    const rows = codesRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === code);

    // Проверки
    if (rowIndex === -1) return res.json({ success: false, message: "Код не найден!" });
    if (rows[rowIndex][1] === "TRUE") return res.json({ success: false, message: "Код уже использован!" });

    // Если всё ок — выбираем приз
    const prizes = await getPrizes();
    const prize = weightedRandom(prizes);
    const prizeIndexInList = prizes.findIndex(p => p.name === prize.name);

    // Записываем в таблицу (строка + 2, т.к. начали с A2 и индекс с 0)
    const writeRow = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `keys!B${writeRow}:D${writeRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [["TRUE", nickname, prize.name]] }
    });

    res.json({
      success: true,
      prize: prize.name,
      index: prizeIndexInList,
      total_segments: prizes.length
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
