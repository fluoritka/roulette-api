const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// ID твоей таблицы
const SHEET_ID = "1EzLQpw13NtoJK2EEXRmRsezRvz3sAOOC_DXNFvXcQyw";

// Авторизация через Secret File на Render
const auth = new google.auth.GoogleAuth({
  keyFile: './secrets.json', 
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

// 1. Получаем список призов (учитываем 4 колонки: имя, шанс, склад, цвет)
async function getPrizes() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'prizes!A2:D' 
  });
  
  const rows = res.data.values;
  if (!rows || rows.length === 0) return [];

  return rows
    .filter(r => r[0] && r[1]) // Убираем пустые строки
    .map((r, index) => ({ 
      name: r[0], 
      chance: Number(r[1]), 
      stock: Number(r[2]) || 0, // Колонка C: Количество
      color: r[3] || "#333333", // Колонка D: Цвет
      rowNum: index + 2         // Номер строки для обновления склада
    }));
}

// 2. Рандом (выбираем только из тех, что есть в наличии)
function weightedRandom(prizes) {
  const availablePrizes = prizes.filter(p => p.stock > 0);
  if (availablePrizes.length === 0) return null;

  const total = availablePrizes.reduce((sum, p) => sum + p.chance, 0);
  let rand = Math.random() * total;
  for (let p of availablePrizes) {
    if (rand < p.chance) return p;
    rand -= p.chance;
  }
  return availablePrizes[0];
}

// 3. Эндпоинт для отрисовки колеса (отдает имена и цвета)
app.get('/get_prizes_list', async (req, res) => {
  try {
    const prizes = await getPrizes();
    if (prizes.length === 0) return res.json({ prizes: [] });
    
    // Передаем и имя, и цвет для фронтенда
    res.json({ 
      prizes: prizes.map(p => ({ name: p.name, color: p.color })) 
    });
  } catch (e) { 
    console.error("Ошибка в get_prizes_list:", e.message);
    res.status(500).json({ error: "Не удалось загрузить призы" }); 
  }
});

// 4. Логика крутки
app.post('/spin', async (req, res) => {
  const { code, nickname } = req.body;

  try {
    // Проверка ключей
    const codesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'keys!A2:D' 
    });

    const rows = codesRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === code);

    if (rowIndex === -1) return res.json({ success: false, message: "Код не найден!" });
    if (rows[rowIndex][1] === "TRUE") return res.json({ success: false, message: "Код уже использован!" });

    // Получаем призы и выбираем победителя
    const allPrizes = await getPrizes();
    const prize = weightedRandom(allPrizes);

    if (!prize) return res.json({ success: false, message: "Все призы на складе закончились!" });

    const prizeIndexInList = allPrizes.findIndex(p => p.name === prize.name);

    // ОБНОВЛЕНИЕ ТАБЛИЦЫ (За один раз обновляем и ключ, и склад)
    
    // 1. Помечаем ключ как использованный
    const keyRow = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `keys!B${keyRow}:D${keyRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [["TRUE", nickname, prize.name]] }
    });

    // 2. Уменьшаем количество призов на складе (Колонка C)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `prizes!C${prize.rowNum}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[prize.stock - 1]] }
    });

    res.json({
      success: true,
      prize: prize.name,
      index: prizeIndexInList,
      total_segments: allPrizes.length
    });

  } catch (e) {
    console.error("Критическая ошибка:", e.message);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
