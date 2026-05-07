const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

const SHEET_ID = "1EzLQpw13NtoJK2EEXRmRsezRvz3sAOOC_DXNFvXcQyw";

const auth = new google.auth.GoogleAuth({
  keyFile: './secrets.json', 
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

// 1. Получаем список призов
async function getPrizes() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'prizes!A2:D' 
  });
  
  const rows = res.data.values;
  if (!rows || rows.length === 0) return [];

  return rows
    .filter(r => r[0] && r[1]) 
    .map((r, index) => {
      // Очистка шанса: заменяем запятую на точку и убираем лишние символы
      const rawChance = String(r[1]).replace(',', '.');
      return { 
        name: r[0], 
        chance: parseFloat(rawChance) || 0, 
        stock: parseInt(r[2]) || 0,
        color: r[3] || "#333333",
        rowNum: index + 2
      };
    });
}

// 2. ИСПРАВЛЕННЫЙ РАНДОМ
function weightedRandom(prizes) {
  // Выбираем только те, что реально есть на складе и у которых шанс > 0
  const availablePrizes = prizes.filter(p => p.stock > 0 && p.chance > 0);
  
  if (availablePrizes.length === 0) return null;

  // Считаем сумму шансов
  const totalWeight = availablePrizes.reduce((sum, p) => sum + p.chance, 0);
  
  // Генерируем случайное число от 0 до totalWeight
  let rand = Math.random() * totalWeight;
  
  console.log(`--- Spin Log ---`);
  console.log(`Total weight: ${totalWeight}, Random roll: ${rand}`);

  for (let p of availablePrizes) {
    if (rand < p.chance) {
      console.log(`Winner selected: ${p.name} (Chance: ${p.chance})`);
      return p;
    }
    rand -= p.chance;
  }
  
  // На случай математической погрешности возвращаем последний элемент
  return availablePrizes[availablePrizes.length - 1];
}

// 3. Эндпоинт для отрисовки колеса
app.get('/get_prizes_list', async (req, res) => {
  try {
    const prizes = await getPrizes();
    if (prizes.length === 0) return res.json({ prizes: [] });
    
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
    const codesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'keys!A2:D' 
    });

    const rows = codesRes.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === code);

    if (rowIndex === -1) return res.json({ success: false, message: "Код не найден!" });
    if (rows[rowIndex][1] === "TRUE") return res.json({ success: false, message: "Код уже использован!" });

    const allPrizes = await getPrizes();
    const prize = weightedRandom(allPrizes);

    if (!prize) return res.json({ success: false, message: "Все призы на складе закончились!" });

    const prizeIndexInList = allPrizes.findIndex(p => p.name === prize.name);

    const keyRow = rowIndex + 2;
    // Обновляем ключ
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `keys!B${keyRow}:D${keyRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [["TRUE", nickname, prize.name]] }
    });

    // Уменьшаем склад
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
