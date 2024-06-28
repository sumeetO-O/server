const mysql = require('mysql2');

const pool = mysql.createPool({
  host: 'localhost', // or your MySQL server address
  user: 'root',
  password: '0000',
  database: 'eyrc',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
// const ids = ['1', '2', 5];
// console.log(ids.map(() => '?').join(','));
// pool.query(`SELECT * FROM slots WHERE id IN (${ids.map(() => '?').join(',')}) AND slot_left > 0`, ids,(error, results) => {
//     if (error) throw error;
//     console.log(results);
//   });

// const body = {user_id: "RED", email: "kit.93@gmail.com"};

// const fieldsToUpdate = {};
//   for (let key in body) {
//     if (key === 'user_id') continue; // Exclude updating the user_id itself
//     fieldsToUpdate[key] = body[key];
//   }

const user_id = 'CL_999';

  pool.query(`SELECT booked_slot FROM slot_log WHERE user_id = ?`, user_id,(err, res) => {
    if(err) {
        console.log("ERROR");
    }
    console.log(res[0].booked_slot[0]);
  })


  