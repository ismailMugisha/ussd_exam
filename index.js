const express = require("express");
const { Pool } = require("pg");
const app = express();

// Logging Middleware (moved to top)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`, req.body);
  next();
});

app.use(express.urlencoded({ extended: true }));

// PostgreSQL connection
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_8QwYhMGca6eP@ep-wild-flower-a81u5lv2-pooler.eastus2.azure.neon.tech/neondb?sslmode=require"
});

// USSD States
const STATES = {
  LANGUAGE_SELECTION: 'LANGUAGE_SELECTION',
  WEIGHT_INPUT: 'WEIGHT_INPUT',
  HEIGHT_INPUT: 'HEIGHT_INPUT',
  BMI_RESULT: 'BMI_RESULT',
  TIPS_SELECTION: 'TIPS_SELECTION',
  PREVIOUS_RECORD: 'PREVIOUS_RECORD'
};

// Messages
const MESSAGES = {
  en: {
    welcome: "Welcome to BMI App\n1. English\n2. Kinyarwanda",
    weight_input: "Enter your weight in KGs:\n0. Back",
    height_input: "Enter your height in CMs:\n0. Back",
    invalid_weight: "Invalid weight. Please enter 10–500kg:\n0. Back",
    invalid_height: "Invalid height. Please enter 50–300cm:\n0. Back",
    tips_question: "Would you like health tips?\n1. Yes\n2. No\n0. Back",
    thank_you: "Thank you for using BMI App!",
    db_error: "System error. Please try again later.",
    invalid_input: "Invalid input. Please try again.",
    new_check: "1. New check\n2. Exit",
    underweight: "You are underweight.",
    normal: "You are normal.",
    overweight: "You are overweight.",
    obese: "You are obese.",
    underweight_tips: "Eat more calories, proteins, nuts and dairy.",
    normal_tips: "Maintain healthy eating and stay active.",
    overweight_tips: "Eat more greens, reduce sugar and fat.",
    obese_tips: "Avoid processed foods and consult a doctor.",
  },
  rw: {
    welcome: "Murakaza neza kuri BMI App\n1. English\n2. Kinyarwanda",
    weight_input: "Andika ibiro byawe (KG):\n0. Subira inyuma",
    height_input: "Andika uburebure bwawe (CM):\n0. Subira inyuma",
    invalid_weight: "Ibiro ntibyemewe. Andika hagati ya 10-500kg:\n0. Subira inyuma",
    invalid_height: "Uburebure ntibwemewe. Andika hagati ya 50-300cm:\n0. Subira inyuma",
    tips_question: "Wifuza inama z'ubuzima?\n1. Yego\n2. Oya\n0. Subira inyuma",
    thank_you: "Murakoze gukoresha BMI App!",
    db_error: "Hari ikosa. Gerageza ukundi nyuma.",
    invalid_input: "Icyo watanze nticyemewe. Gerageza ukundi.",
    new_check: "1. Tangira bushya\n2. Sohoka",
    underweight: "Ufite ibiro biri hasi cyane.",
    normal: "Ufite ibiro bisanzwe.",
    overweight: "Ufite ibiro birenze.",
    obese: "Ufite ibiro byinshi cyane.",
    underweight_tips: "Fata ibirimo intungamubiri nyinshi nka ubunyobwa.",
    normal_tips: "Komereza aho! Fata indyo yuzuye kandi ukore siporo.",
    overweight_tips: "Fata imboga nyinshi, gabanya isukari n'amavuta.",
    obese_tips: "Irinde ibiribwa byatunganyijwe kandi ushake inama kwa muganga.",
  }
};

// Helper functions
function getMessage(lang = 'en', key) {
  if (MESSAGES[lang] && MESSAGES[lang][key]) return MESSAGES[lang][key];
  return MESSAGES.en[key] || "Message not found.";
}

function validateWeight(w) {
  const weight = parseFloat(w);
  return !isNaN(weight) && weight >= 10 && weight <= 500;
}

function validateHeight(h) {
  const height = parseFloat(h);
  return !isNaN(height) && height >= 50 && height <= 300;
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

app.post("/", async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  let steps = text.trim() === "" ? [] : text.trim().split("*");
  let input = steps[steps.length - 1] || "";
  
  console.log(`Processing request for ${phoneNumber}, steps: ${JSON.stringify(steps)}, input: ${input}`);

  try {
    // Get user from database
    const { rows } = await pool.query("SELECT * FROM users WHERE phone_number = $1", [phoneNumber]);
    let user = rows[0];

    // Handle back navigation
    if (input === "0" && steps.length > 1) {
      if (user) {
        // Navigate back based on current state
        switch (user.current_state) {
          case STATES.HEIGHT_INPUT:
            await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.WEIGHT_INPUT, user.id]);
            return res.send("CON " + getMessage(user.language, 'weight_input'));
          
          case STATES.BMI_RESULT:
            await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.HEIGHT_INPUT, user.id]);
            return res.send("CON " + getMessage(user.language, 'height_input'));
          
          case STATES.TIPS_SELECTION:
            // Go back to showing BMI result
            const { rows: resultRows } = await pool.query("SELECT * FROM results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [user.id]);
            if (resultRows.length > 0) {
              const result = resultRows[0];
              const status = getBMIStatus(result.bmi, user.language);
              await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.BMI_RESULT, user.id]);
              return res.send("CON Your BMI is " + result.bmi + ". " + status + "\n" + getMessage(user.language, 'tips_question'));
            }
            break;
          
          default:
            if (user.current_state === STATES.WEIGHT_INPUT) {
              // Go back to previous record or language selection
              const { rows: recordRows } = await pool.query("SELECT * FROM results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [user.id]);
              if (recordRows.length > 0) {
                await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.PREVIOUS_RECORD, user.id]);
                const r = recordRows[0];
                const status = getBMIStatus(r.bmi, user.language);
                const message = `Last BMI: ${r.bmi} (${status})\nWeight: ${r.weight}kg, Height: ${r.height}cm\n${getMessage(user.language, 'new_check')}`;
                return res.send("CON " + message);
              } else {
                await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.LANGUAGE_SELECTION, user.id]);
                return res.send("CON " + getMessage('en', 'welcome'));
              }
            }
            break;
        }
      }
      return res.send("CON " + getMessage('en', 'welcome'));
    }

    // Determine current state and language
    let currentState;
    let lang = 'en';

    if (steps.length === 0) {
      // First interaction
      currentState = STATES.LANGUAGE_SELECTION;
    } else if (steps.length === 1 && (steps[0] === "1" || steps[0] === "2")) {
      // Language selected
      lang = steps[0] === "2" ? "rw" : "en";
      
      if (!user) {
        // Create new user
        const { rows: newUserRows } = await pool.query(
          "INSERT INTO users (phone_number, language, current_state) VALUES ($1, $2, $3) RETURNING *",
          [phoneNumber, lang, STATES.PREVIOUS_RECORD]
        );
        user = newUserRows[0];
      } else {
        // Update existing user language
        await pool.query("UPDATE users SET language = $1, current_state = $2 WHERE id = $3", 
          [lang, STATES.PREVIOUS_RECORD, user.id]);
        user.language = lang;
        user.current_state = STATES.PREVIOUS_RECORD;
      }
      
      currentState = STATES.PREVIOUS_RECORD;
    } else {
      // Continuing with existing user
      if (!user) {
        return res.send("END " + getMessage('en', 'db_error'));
      }
      lang = user.language;
      currentState = user.current_state;
    }

    // Process based on current state
    switch (currentState) {
      case STATES.LANGUAGE_SELECTION:
        return res.send("CON " + getMessage('en', 'welcome'));

      case STATES.PREVIOUS_RECORD:
        // Check if user has previous records
        const { rows: records } = await pool.query("SELECT * FROM results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [user.id]);
        
        if (records.length > 0 && steps.length === 1) {
          // Show previous record
          const r = records[0];
          const status = getBMIStatus(r.bmi, lang);
          const message = `Last BMI: ${r.bmi} (${status})\nWeight: ${r.weight}kg, Height: ${r.height}cm\n${getMessage(lang, 'new_check')}`;
          return res.send("CON " + message);
        } else if (input === "1") {
          // Start new check
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.WEIGHT_INPUT, user.id]);
          return res.send("CON " + getMessage(lang, 'weight_input'));
        } else if (input === "2") {
          // Exit
          return res.send("END " + getMessage(lang, 'thank_you'));
        } else if (records.length === 0) {
          // No previous records, go directly to weight input
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.WEIGHT_INPUT, user.id]);
          return res.send("CON " + getMessage(lang, 'weight_input'));
        } else {
          return res.send("CON " + getMessage(lang, 'invalid_input') + "\n" + getMessage(lang, 'new_check'));
        }

      case STATES.WEIGHT_INPUT:
        if (!validateWeight(input)) {
          return res.send("CON " + getMessage(lang, 'invalid_weight'));
        }
        // Valid weight, move to height input
        await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.HEIGHT_INPUT, user.id]);
        return res.send("CON " + getMessage(lang, 'height_input'));

      case STATES.HEIGHT_INPUT:
        if (!validateHeight(input)) {
          return res.send("CON " + getMessage(lang, 'invalid_height'));
        }
        
        // Get weight from previous step
        const weightStep = steps[steps.length - 2];
        if (!validateWeight(weightStep)) {
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.WEIGHT_INPUT, user.id]);
          return res.send("CON " + getMessage(lang, 'weight_input'));
        }
        
        const weight = parseFloat(weightStep);
        const height = parseFloat(input);
        const bmi = calculateBMI(weight, height);
        const status = getBMIStatus(bmi, lang);
        
        // Save result
        await pool.query("INSERT INTO results (user_id, weight, height, bmi) VALUES ($1, $2, $3, $4)",
          [user.id, weight, height, bmi]);
        
        // Update state
        await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.BMI_RESULT, user.id]);
        
        return res.send("CON Your BMI is " + bmi + ". " + status + "\n" + getMessage(lang, 'tips_question'));

      case STATES.BMI_RESULT:
        // This should transition to tips selection
        await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.TIPS_SELECTION, user.id]);
        if (input === "1") {
          // Show tips
          const { rows: resultRows } = await pool.query("SELECT * FROM results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [user.id]);
          const result = resultRows[0];
          const tips = getBMITips(result.bmi, lang);
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.PREVIOUS_RECORD, user.id]);
          return res.send("END " + tips);
        } else if (input === "2") {
          // No tips
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.PREVIOUS_RECORD, user.id]);
          return res.send("END " + getMessage(lang, 'thank_you'));
        } else {
          return res.send("CON " + getMessage(lang, 'invalid_input') + "\n" + getMessage(lang, 'tips_question'));
        }

      case STATES.TIPS_SELECTION:
        if (input === "1") {
          // Show tips
          const { rows: resultRows } = await pool.query("SELECT * FROM results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [user.id]);
          const result = resultRows[0];
          const tips = getBMITips(result.bmi, lang);
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.PREVIOUS_RECORD, user.id]);
          return res.send("END " + tips);
        } else if (input === "2") {
          // No tips
          await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.PREVIOUS_RECORD, user.id]);
          return res.send("END " + getMessage(lang, 'thank_you'));
        } else {
          return res.send("CON " + getMessage(lang, 'invalid_input') + "\n" + getMessage(lang, 'tips_question'));
        }

      default:
        console.error("Unknown state:", currentState);
        await pool.query("UPDATE users SET current_state = $1 WHERE id = $2", [STATES.PREVIOUS_RECORD, user?.id]);
        return res.send("END " + getMessage(lang, 'db_error'));
    }

  } catch (error) {
    console.error("Fatal error:", error);
    return res.send("END " + getMessage('en', 'db_error'));
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`USSD BMI App running on http://localhost:${PORT}`);
});