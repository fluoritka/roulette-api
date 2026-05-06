const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// Твой ID таблицы
const SHEET_ID = "1EzLQpw13NtoJK2EEXRmRsezRvz3sAOOC_DXNFvXcQyw";

// Подключаем ключи через Secret File, который ты создал на Render
const auth = new google.auth.GoogleAuth({
  keyFile: './secrets.json', 
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

// 1. Получаем список призов
async function getPrizes() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'prizes!A2:B' 
  });
  
  const rows = res.data.values;
  // Если лист пустой, возвращаем пустой массив, чтобы код не падал
  if (!rows || rows.length === 0) return [];

  return rows
    .filter(r => r[0] && r[1]) // Убираем пустые строки
    .map(r => ({ name: r[0], chance: Number(r[1]) }));
}

// 2. Рандом
function weightedRandom(prizes) {
  const total = prizes.reduce((sum, p) => sum + p.chance, 0);
  let rand = Math.random() * total;
  for (let p of prizes) {
    if (rand < p.chance) return p;
    rand -= p.chance;
  }
  return prizes[0]; // Страховка
}

// 3. Список для колеса
app.get('/get_prizes_list', async (req, res) => {
  try {
    const prizes = await getPrizes();
    if (prizes.length === 0) return res.json({ names: ["Ошибка таблицы"] });
    res.json({ names: prizes.map(p => p.name) });
  } catch (e) { 
    console.error("Ошибка в get_prizes_list:", e.message);
    res.status(500).json({ error: "Не удалось загрузить призы" }); 
  }
});

// 4. Логика крутки
app.post('/spin', async (req, res) => {
  const { code, nickname } = req.body;

  try {
    const codesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'keys!A2:D' 
    });

    const rows = codesRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === code);

    if (rowIndex === -1) return res.json({ success: false, message: "Код не найден!" });
    if (rows[rowIndex][1] === "TRUE") return res.json({ success: false, message: "Код уже использован!" });

    const prizes = await getPrizes();
    if (prizes.length === 0) return res.status(500).json({ success: false, message: "Призы не настроены" });

    const prize = weightedRandom(prizes);
    
    // Проверка, что приз определился
    if (!prize) throw new Error("Не удалось выбрать приз");

    const prizeIndexInList = prizes.findIndex(p => p.name === prize.name);

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
    console.error("Критическая ошибка:", e.message);
    res.status(500).json({ success: false, message: "Ошибка на сервере" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
