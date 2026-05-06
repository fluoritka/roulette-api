const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// ID твоей таблицы
const SHEET_ID = "1EzLQpw13NtoJK2EEXRmRsezRvz3sAOOC_DXNFvXcQyw";

// ИСПОЛЬЗУЕМ ФАЙЛ secrets.json, который ты загрузил на Render
const auth = new google.auth.GoogleAuth({
  keyFile: './secrets.json', 
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

// 1. Получаем список призов и шансов
async function getPrizes() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'prizes!A2:B' 
  });
  
  // Добавлена проверка на пустые строки, чтобы сервер не падал
  if (!res.data.values) return [];
  return res.data.values
    .filter(r => r[0] && r[1]) 
    .map(r => ({ name: r[0], chance: Number(r[1]) }));
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
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: e.message }); 
  }
});

// 4. ГЛАВНАЯ ЛОГИКА: КРУТКА
app.post('/spin', async (req, res) => {
  const { code, nickname } = req.body;

  try {
    // Получаем ключи
    const codesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'keys!A2:D' 
    });

    const rows = codesRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === code);

    if (rowIndex === -1) return res.json({ success: false, message: "Код не найден!" });
    if (rows[rowIndex][1] === "TRUE") return res.json({ success: false, message: "Код уже использован!" });

    const prizes = await getPrizes();
    if (prizes.length === 0) throw new Error("Список призов пуст");

    const prize = weightedRandom(prizes);
    const prizeIndexInList = prizes.findIndex(p => p.name === prize.name);

    // Запись результата в таблицу
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
    console.error("Ошибка на сервере:", e.message);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

const PORT = process.env.PORT || 10000; // Render использует порт 10000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
