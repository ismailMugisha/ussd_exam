const express = require("express");
const { Pool } = require("pg");
const app = express();
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_8QwYhMGca6eP@ep-wild-flower-a81u5lv2-pooler.eastus2.azure.neon.tech/neondb?sslmode=require"
});

const STATES = {
  LANGUAGE_SELECTION: 'LANGUAGE_SELECTION',
  WEIGHT_INPUT: 'WEIGHT_INPUT',
  HEIGHT_INPUT: 'HEIGHT_INPUT',
  BMI_RESULT: 'BMI_RESULT',
  TIPS_SELECTION: 'TIPS_SELECTION',
  PREVIOUS_RECORD: 'PREVIOUS_RECORD'
};

const MESSAGES = { /* same MESSAGES object as before */ };

function getMessage(lang, key) {
  return MESSAGES[lang] ? MESSAGES[lang][key] : MESSAGES.en[key];
}

function validateWeight(weight) {
  const w = parseFloat(weight);
  return !isNaN(w) && w >= 10 && w <= 500;
}

function validateHeight(height) {
  const h = parseFloat(height);
  return !isNaN(h) && h >= 50 && h <= 300;
}

function calculateBMI(weight, height) {
  return +(weight / ((height / 100) ** 2)).toFixed(1);
}

function getBMIStatus(bmi, lang) {
  if (bmi < 18.5) return getMessage(lang, 'underweight');
  if (bmi < 25) return getMessage(lang, 'normal');
  if (bmi < 30) return getMessage(lang, 'overweight');
  return getMessage(lang, 'obese');
}

function getBMITips(bmi, lang) {
  if (bmi < 18.5) return getMessage(lang, 'underweight_tips');
  if (bmi < 25) return getMessage(lang, 'normal_tips');
  if (bmi < 30) return getMessage(lang, 'overweight_tips');
  return getMessage(lang, 'obese_tips');
}

function getStateFromInput(user, steps, currentStep) {
  if (!user) return currentStep === 0 ? STATES.LANGUAGE_SELECTION : STATES.WEIGHT_INPUT;

  switch (user.current_state) {
    case STATES.LANGUAGE_SELECTION: return STATES.PREVIOUS_RECORD;
    case STATES.PREVIOUS_RECORD: return steps[1] === '1' ? STATES.WEIGHT_INPUT : null;
    case STATES.WEIGHT_INPUT: return STATES.HEIGHT_INPUT;
    case STATES.HEIGHT_INPUT: return STATES.BMI_RESULT;
    case STATES.BMI_RESULT: return STATES.TIPS_SELECTION;
    case STATES.TIPS_SELECTION: return null;
    default: return STATES.PREVIOUS_RECORD;
  }
}

function handleBackButton(user, steps) {
  if (!user) return steps.length <= 1 ? STATES.LANGUAGE_SELECTION : STATES.WEIGHT_INPUT;

  switch (user.current_state) {
    case STATES.HEIGHT_INPUT: return STATES.WEIGHT_INPUT;
    case STATES.BMI_RESULT: return STATES.HEIGHT_INPUT;
    case STATES.TIPS_SELECTION: return STATES.BMI_RESULT;
    default: return STATES.PREVIOUS_RECORD;
  }
}

app.post("/", async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  let steps = text.trim() === "" ? [] : text.trim().split("*");
  let input = steps[steps.length - 1];
  let currentStep = steps.length;

  if (input === "0" && currentStep > 1) {
    steps = steps.slice(0, -2);
    currentStep = steps.length;
    input = steps[steps.length - 1] || "";
  }

  try {
    const userRes = await pool.query("SELECT * FROM users WHERE phone_number = $1", [phoneNumber]);
    const user = userRes.rows[0];

    let currentState = input === "0" && currentStep >= 1
      ? handleBackButton(user, steps)
      : getStateFromInput(user, steps, currentStep);

    switch (currentState) {
      case STATES.LANGUAGE_SELECTION:
        return res.send("CON " + getMessage('en', 'welcome'));

      case STATES.WEIGHT_INPUT:
        if (!user && currentStep === 1) {
          const lang = steps[0] === "2" ? "rw" : "en";
          await pool.query("INSERT INTO users (phone_number, language, current_state) VALUES ($1, $2, $3)", [phoneNumber, lang, STATES.WEIGHT_INPUT]);
          return res.send("CON " + getMessage(lang, 'weight_input'));
        } else if (user) {
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.WEIGHT_INPUT, user.id]);
          return res.send("CON " + getMessage(user.language, 'weight_input'));
        }
        break;

      case STATES.HEIGHT_INPUT:
        if (!validateWeight(input)) {
          return res.send("CON " + getMessage(user.language, 'invalid_weight'));
        }
        await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.HEIGHT_INPUT, user.id]);
        return res.send("CON " + getMessage(user.language, 'height_input'));

      case STATES.BMI_RESULT:
        if (!validateHeight(input)) {
          return res.send("CON " + getMessage(user.language, 'invalid_height'));
        }
        const weight = parseFloat(steps[steps.length - 2]);
        const height = parseFloat(input);
        const bmi = calculateBMI(weight, height);
        const status = getBMIStatus(bmi, user.language);

        await pool.query("INSERT INTO results (user_id, weight, height, bmi) VALUES ($1, $2, $3, $4)", [user.id, weight, height, bmi]);
        await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.BMI_RESULT, user.id]);

        const message = `Your BMI is ${bmi}. ${status}\n${getMessage(user.language, 'tips_question')}`;
        return res.send("CON " + message);

      case STATES.TIPS_SELECTION:
        if (input === "1") {
          const resultRes = await pool.query("SELECT * FROM results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [user.id]);
          const result = resultRes.rows[0];

          const tips = getBMITips(result.bmi, user.language);
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.PREVIOUS_RECORD, user.id]);
          return res.send("END " + tips);
        } else if (input === "2") {
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.PREVIOUS_RECORD, user.id]);
          return res.send("END " + getMessage(user.language, 'thank_you'));
        } else {
          return res.send("CON " + getMessage(user.language, 'invalid_input') + "\n" + getMessage(user.language, 'tips_question'));
        }

      case STATES.PREVIOUS_RECORD:
        const lastRes = await pool.query("SELECT * FROM results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [user.id]);
        const lastResult = lastRes.rows[0];

        if (lastResult) {
          const bmi = lastResult.bmi;
          const status = getBMIStatus(bmi, user.language);
          const message = `Last BMI: ${bmi} (${status})\nWeight: ${lastResult.weight}kg, Height: ${lastResult.height}cm\n${getMessage(user.language, 'new_check')}`;
          return res.send("CON " + message);
        } else {
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.WEIGHT_INPUT, user.id]);
          return res.send("CON " + getMessage(user.language, 'weight_input'));
        }

      case null:
        if (user) {
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.PREVIOUS_RECORD, user.id]);
        }
        return res.send("END " + getMessage(user ? user.language : 'en', 'thank_you'));

      default:
        return res.send("END " + getMessage(user ? user.language : 'en', 'invalid_input'));
    }
  } catch (err) {
    console.error("Server error:", err);
    return res.send("END " + getMessage('en', 'db_error'));
  }
});

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`, req.body);
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`USSD BMI App running on http://localhost:${PORT}`);
});
