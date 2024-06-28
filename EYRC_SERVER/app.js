require('dotenv').config();

const express = require("express");
const http = require("http");
const mysql = require('mysql2');
const path = require("path");
const { exec, execSync } = require('child_process');
const socketIo = require('socket.io');
const axios = require('axios'); // for doing http req. from server side (here using to check if ide page is up and running);

const { stdout } = require("process");

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// MySQL Connection Pool -------------------
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
// ----------------------

const io = socketIo(server, {
  cors: {
      origin: '*', // Allow all origins (use with caution)
      methods: ['GET']
  }
});

// Middleware to verify the token
io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
      return next(new Error('Unauthorized! Socket Can not be formed...'));
  }
  // verify user token --
  pool.query('SELECT * FROM USERS_DATA WHERE token = ?', [token], (error, results) => {
    if (error) {
      console.error('Error verifying token:', error);
      return next(new Error('Unauthorized! Socket cannot be formed...'));
    }

    if (results.length > 0) {
      const user = results[0];
      console.log('TOKEN VERIFIED FOR SOCKET!', user.user_id);
      socket.user = user;

      // Fetch booking data from MySQL --
      pool.query('SELECT * FROM slot_log WHERE user_id = ?', [user.user_id], (error, bookingResults) => {
        if (error) {
          console.error('Error fetching booking data:', error);
          return next(new Error('Error fetching booking data:', error));
        }
        
        if (bookingResults.length > 0) {
            socket.booking_details = bookingResults[0];
            next();
        } else {
          console.log('No booking found...');
          return next(new Error('No booking found...'));
        }
      });

    } else {
        return next(new Error('Unauthorized(Token Invalid)! Socket cannot be formed...'));
    }
  });
  
});

io.on('connection', (socket) => {
  // Send time to client every second
  const sendTime = setInterval(() => {
    const currentTime = Date.now();
    socket.emit('time', { datetime: currentTime });
  }, 1000);

  socket.on('disconnect', () => {
    console.log('User disconnected');
    clearInterval(sendTime);
  });
});


const indexHtml = path.resolve(__dirname, 'index.html');
const ihtml = path.resolve(__dirname, 'i.html'); // DELETE THIS LATER (FOR DEBUGGING ONLY)

// Admin credentials (for demonstration purposes, store them securely in a real application)
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

// MIDDLEWARE - PLUGIN ----------------------------------------------------------------
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static('./'));


// Function to generate a random port number within the specified range
function generateRandomPort(start, end) {
  return Math.floor(Math.random() * (end - start + 1)) + start;
}

// Middleware for token verification -------------
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  console.log(authHeader)
  if (authHeader) {
    const token = authHeader.split(" ")[1];
    console.log(token);
    // get user from token ---
    pool.query('SELECT * FROM USERS_DATA WHERE token = ?', [token], (error, results) => {
        if (error) {
          console.error('Error verifying token:', error);
        }

        if (results.length > 0) {
          req.user = results[0];    // Attach the user to the request object
          console.log('TOKEN VERIFIED!', req.user);
          next();    // Pass control to the next middleware or route handler
        } else {
            res.status(403).json({ status: "Forbidden" });
        }
    });

  } else {
    res.status(401).json({ status: "Unauthorized" });
  }
}

// Middleware for admin authentication
function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const credentials = Buffer.from(authHeader.split(" ")[1], 'base64').toString('ascii');
    const [username, password] = credentials.split(":");
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      next();
    } else {
      res.status(403).json({ status: "Forbidden" });
    }
  } else {
    res.status(401).json({ status: "Unauthorized" });
  }
}

// Middleware to check if user already booked, if yes then stop and return booking details if no, then move next --
function checkIfAlreadyBooked(req, res, next) {

    const token_user_id = req.user.user_id;
    // SQL query to check if user has an existing booking
    const sqlQuery = 'SELECT * FROM slot_log WHERE user_id = ?';

    pool.query(sqlQuery, token_user_id, (error, results) => {
        if (error) {
            console.error('Error checking if booked:', error);
            return res.status(500).json({ status: "Error checking if booked", error: error });
        }

        if (results.length > 0) {
            // User has an existing booking
            res.json({
                status: "Already Booked",
                slot: results[0]
            });
        } else {
            // User does not have an existing booking, proceed to next middleware (updating logs for new booking)
            next();
        }
    });
}


// Middleware for updating logs of Booked Slots -------------
function updateLogs(req, res, next) {
    const slot_id_JSON = JSON.parse(req.body.slot_id);
    const slot_id = Array.from(Object.values(slot_id_JSON));

    const user = req.user;
    // TODO : Make sure the booking_id is unique and is not already present in booking section ------ 
    const booking_id = Math.floor(100000 + Math.random() * 900000);
    const booking_date = new Date();
    console.log(slot_id.map(() => '?').join(','));
    console.log(`Slot Id: ${slot_id}, Type of Slot_id : ${typeof(slot_id)}, length: ${slot_id.length}`);

    // if (typeof(slot_id) !== 'object' || slot_id.length === 0) {
    //     return res.status(400).json({ status: "Bad Request", message: "Invalid slot_id array" });
    // }

    if (user && slot_id.length > 0) {
        const slotQuery = `SELECT * FROM slots WHERE id IN (${slot_id.map(() => '?').join(',')}) AND slot_left > 0`;
        pool.query(slotQuery, slot_id, (error, results) => {
            if (error) {
                console.error('Error fetching slot details:', error);
                return res.status(500).json({ status: "ERROR", error: `Error fetching slot details : ${error}}` });
            }

            if (results.length !== slot_id.length){
                return res.status(404).json({ status: "ERROR",msg: "Error in finding any one of the chosen Slot" });
            }

            const slots = results;
            const bookingQuery = 'INSERT INTO slot_log (booked_on, booking_id, user_id, name, booked_slot) VALUES (?, ?, ?, ?, ?)';
            const values = [
                booking_date, // booked_on timestamp
                booking_id, // booking_id (null or default as per your schema)
                user.user_id,
                `${user.first_name} ${user.last_name}`,
                JSON.stringify(slots.map(slot => ({
                    slot_id: slot.id,
                    date: slot.date,
                    time_from: slot.time_from,
                    time_to: slot.time_to
                })))
            ];

            pool.query(bookingQuery, values, (error, results) => {
                if (error) {
                    console.error('Error inserting booking details:', error);
                    return res.status(500).json({ status: "Error inserting booking details", error: error });
                }

                req.booked_slots = slots;
                next();
            });

        });
    } else {
        res.status(400).json({ status: "Bad Request" });
    }

}

// app.use((req, res, next) => {
//   if(req.path == "/api/slot_book" && req.method == "POST") {
//     const token = req.body.token;
//     const slot_id = Number(req.body.slot_id);
//     const user = users_data.find((u) => {return u.token == token});
//     const slot = slots.find((s) => {return s.id == slot_id});
//     console.log(user);
//     console.log(slot);
//     const slot_body = {
//       booked_on: Date.now(),
//       user_id: user.id,
//       name: user.first_name + user.last_name,
//       booked_slot: {
//         slot_id: slot.id,
//         date: slot.date,
//         time_from: slot.time_from,
//         time_to: slot.time_to
//       }
//     }
//     console.log(slot_body)
//     slot_log.push({id: slot_log.length + 1, ...slot_body});
//     fs.writeFile("./slot_log.json", JSON.stringify(slot_log), (err, data) => {
//       return res.json({ status: "success", slot: booked_slot });
//     });
//   }
//   next();
// });

// Middleware for checking if user has already booked a slot if yes then move next if no then stop and return not booked-------------
function checkBookingDetails(req, res, next) {
    
    const token_user_id = req.user.user_id;

    // SQL query to fetch booking details for the user
    const sqlQuery = 'SELECT * FROM slot_log WHERE user_id = ?';

    pool.query(sqlQuery, token_user_id, (error, results) => {
        if (error) {
            console.error('Error fetching booking details:', error);
            return res.status(500).json({ status: "Error fetching booking details", error: error });
        }

        if (results.length > 0) {
            // Found existing booking details
            req.booking_details = results[0];
            console.log('(checkBookingDetails(), req.booking_details) : ', req.booking_details);
            next();
        } else {
            // No booking details found
            console.error("USER SLOT INFORMATION NOT AVAILABLE!");
            res.json({ is_booked: "NO", status: "Not Booked" });
        }
    });
}



// Middleware for checking if the slot-timing have come and user can start-development
function is_slot_on(req, res, next) {
    const user = req.user;
    // TODO : For now i am considering only 1 booked slot so one countdown (later we have to do for multipe slot bookings so multiple countdown)
    const booked_slot = req.booking_details.booked_slot[0];
    req.booked_slot = booked_slot;
    console.log('(is_slot_on(), req.booked_slot) : ', req.booked_slot);

    const [hours_from, minutes_from, seconds_from] = booked_slot.time_from.split(":");
    const [hours_to, minutes_to, seconds_to] = booked_slot.time_to.split(":");
    const [year, month, day] = booked_slot.date.split('-');

    const time_from = new Date(Number(year), Number(month) - 1, Number(day), Number(hours_from), Number(minutes_from));
    const time_to = new Date(Number(year), Number(month) - 1, Number(day), Number(hours_to), Number(minutes_to));
    const time_now = new Date();



    if (time_now < time_from) {
        res.json({is_booked: "YES", status: "Upcoming" , msg: "Slot is yet to come!", slot: req.booking_details});
    }
    else if (time_now >= time_from && time_now <= time_to) {
        // console.log("TIME LIES IN DOMAIN!");
        req.is_slot_on = "YES";
        next();
    }
    else {
        res.json({is_booked: "YES", status: "Completed" , msg: "Slot is Over!", slot: req.booking_details});
    }
}

// ----------------------------------------------------------


// HYBRID API (Contains handling of both web browser -> [Data response will be HTML rendered from Server Side] and mobile apps -> [Data response will be sent in JSON (raw data) format and will fetched by client and rendered by client only])

// Routes ----------------------------------------------------------------

app.get("/slot_book2", (req, res) => { // DELETE THIS LATER (FOR DEBUGGING ONLY)
  res.sendFile(ihtml);
});

app.get("/slot_book", (req, res) => {
  res.sendFile(indexHtml);
});


// ----------------------------------------------------------------

// REST API ----------------------------------------------------------------

// FOR ADMIN - to check all users
app.get("/api/users", verifyAdmin, (req, res) => {
    pool.query('SELECT * FROM USERS_DATA', (error, results) => {
        if (error) {
          console.error('Error fetching user data:', error);
          res.send(`<h1>Error fetching user data: ${error}</h1>`);
        }

        if(results.length > 0) {
            const html = `
            <ul>
            ${results.map((user) => `<li>${JSON.stringify(user)}</li>`).join("")}
            </ul>`;
        res.send(html);
        }
    });
});
// used to add new users ---
app.post("/api/users", (req, res) => {
  // TODO : Create User --------------------------------
  const user_body = req.body;
  // SQL query to insert a new user
  const query = `INSERT INTO users (id, user_id, first_name, last_name, email, gender, token) VALUES (?, ?, ?, ?, ?, ?, ?)`;

  // Destructure the user_body object to extract values
  const { user_id, first_name, last_name, email, gender, token } = user_body;
  const values = [user_id, first_name, last_name, email, gender, token];

  pool.query(query, values, (err, results) => {
    if (err) {
      console.error('Error creating new user:', err);
      return res.status(500).json({ status: "Error creating new user" });
    }
    res.json({ status: "Success! Your account is ceated..", id: results.insertId });
  });
});


// this will return the available slots -------------
app.get("/api/available_slots", (req, res) => {
    pool.query('SELECT * FROM slots WHERE slot_left > 0', (error, results) => {
        if (error) throw error;
            availableSlots = results;
            return res.json(availableSlots);
      });
});

// will return the slots in db (and perform operations on it)--------------
app.route("/api/slots")
  .get((req, res) => {
    pool.query('SELECT * FROM slots', (error, results) => {
        if (error) throw error;
        availableSlots = results;
        return res.json(availableSlots);
      });
  })
  .post(verifyAdmin, (req, res) => {
    // Extract data from request body
    const { slot_id, tag, date, time_from, time_to, slot_left } = req.body;

    // SQL query to insert into slots table
    const sqlQuery = 'INSERT INTO slots (slot_id, tag, date, time_from, time_to, slot_left) VALUES (?, ?, ?, ?, ?, ?)';
    const new_data = [slot_id, tag, date, time_from, time_to, slot_left];

    pool.query(sqlQuery, new_data, (error, results) => {
        if (error) {
            console.log('Error inserting slot:', error);
            return res.status(500).json({ status: "Error inserting slot" , error: error });
        }
        // Respond with success and the ID of the newly inserted slot
        res.json({ 
        status: "Success! Slot Added successfully", 
        new_slot: { 
            id: results.insertId, // ID of the inserted row
            ...req.body // Include the other slot details from the request
        } 
        });
    });
  });
// perform operation on slot --------------------
app.route("/api/slots/:slot_id")
  .patch(verifyAdmin, (req, res) => {
    const slot_id = req.params.slot_id;
    const updateData = req.body;
    if (!slot_id) {
        return res.status(400).json({ status: "Error", message: "slot_id is required" });
    }
    // Build the SQL query dynamically based on provided data
    const fields = Object.keys(updateData);
    const values = Object.values(updateData);

    if (fields.length === 0) {
        return res.status(400).json({ status: "Error", message: "No data provided to update" });
    }

    const sqlQuery = `UPDATE slots SET ${fields.map(field => `${field} = ?`).join(', ')} WHERE slot_id = ?`;
    values.push(slot_id); // Add slot_id to the end of the values array

    pool.query(sqlQuery, values, (error, results) => {
        if (error) {
            console.log('Error updating slot:', error);
            return res.status(500).json({ status: "Error updating slot", error: error });
        }
        if (results.affectedRows === 0) {
            return res.status(404).json({ status: "Error", message: "Slot not found" });
        }
        res.json({ 
            status: "Success! Slot updated successfully",
            updated_slot: {
                slot_id,
                ...updateData // Include the updated slot details from the request
            } 
        });
    });
  })
  .delete(verifyAdmin, (req, res) => {
    const slot_id = req.params.slot_id;
    if (!slot_id) {
        return res.status(400).json({ status: "Error", message: "slot_id is required" });
    }
    // SQL query to delete the slot based on slot_id
    const sqlQuery = 'DELETE FROM slots WHERE slot_id = ?';

    pool.query(sqlQuery, slot_id, (error, results) => {
        if (error) {
            console.log('Error deleting slot:', error);
            return res.status(500).json({ status: "Error deleting slot", error: error });
        }
        if (results.affectedRows === 0) {
            return res.status(404).json({ status: "Error", message: "Slot not found" });
        }
        res.json({ 
            status: "Success! Slot deleted successfully",
            deleted_slot: {
                slot_id
            } 
        });
    });
  });


// checks the status of slot ---------------------
app.get("/api/slot_book", verifyToken, checkBookingDetails, is_slot_on, (req, res) => {
  res.json({ is_booked: "YES", status: "Ongoing", msg: "Slot is Ongoing!", slot: req.booking_details});
});
// for booking the slots by updating slot_log table ----(in case if already booked then returns booking_details)----
app.post("/api/slot_book", verifyToken, checkIfAlreadyBooked, updateLogs, (req, res) => {
    const booked_slots = req.booked_slots;
    const slot_id_JSON = JSON.parse(req.body.slot_id);
    const slot_id = Array.from(Object.values(slot_id_JSON));

    const query = `
        UPDATE slots
        SET slot_left = slot_left - 1
        WHERE slot_id IN (${slot_id.map(() => '?').join(',')})`;

    // Execute the query with the slotIds array
    pool.query(query, slot_id, (error, results) => {
        if (error){
            res.status(400).json({ status: "Bad Request", msg: `ERROR: ${error}`});
        }
        console.log('Rows affected:', results.affectedRows);
        res.json({ status: "Success! Your Slot is Booked", slot: booked_slots });
    });

});




// GET, PATCH(EDIT) AND POST (NEW) slot_log detail by it's user_id for admin -----
app.route("/api/slot_log/:userid")
  .get(verifyAdmin, (req, res) => { // gives booking details of user by user_id
    const user_id = req.params.userid;
    pool.query(`SELECT * FROM slot_log WHERE user_id = ?`, [user_id], (err, results) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.status(500).json({ status: "Error fetching user data" });
      }
      res.json(results[0]);
    });

  })
  .patch(verifyAdmin, (req, res) => {
    const user_id = req.params.userid;
    const body = { ...req.body, "booked_slot": JSON.stringify(req.body.booked_slot) }; // booked_slot is the JSON field

    // Remove user_id and id (these data can't be changed) from updatedBody if they exist
    if ('user_id' in body){ delete body.user_id; console.log("user_id can't be changed");}
    if ('id' in body){delete body.id; console.log("id can't be changed");}

    // Prepare the dynamic update query
    const fields = Object.keys(body).map(key => `${key} = ?`).join(', ');
    const values = Object.values(body);

    // Prepare the update query
    const query = `UPDATE slot_log SET ${fields} WHERE user_id = ?`;

    pool.query(query, [...values, user_id], (err, results) => {
      if (err) {
        console.error('Error updating slot_log data:', err);
        return res.status(500).json({ status: "Error updating slot_log data" });
      }
      res.json({ status: "Slot_log info Updation Successful!", id: user_id });
    });

  })
  .post(verifyAdmin, (req, res) => {
    res.json({ status: "TODO ...." });
  });

// GET, CHANGE, OR DELETE a user data by it's user_id ----
app.route("/api/users/:userid")
  .get(verifyToken, (req, res) => {
    const user_id = req.params.userid;
    const query = 'SELECT * FROM USERS_DATA WHERE user_id = ?';
    
    pool.query(query, [user_id], (err, results) => {
        if (err) {
          console.error('Error fetching user data:', err);
          return res.status(500).json({ status: "Error fetching user data" });
        }
        const userByUid = results[0];
        if (req.user.user_id === userByUid.user_id) {
          res.json(userByUid);
        } else {
          res.status(403).json({ status: "You are not authorized to access this user!" });
        }
    });
  })
  .patch(verifyToken, (req, res) => {
    const user_id = req.params.userid;
    const body = req.body;
    const user_id_byToken = req.user.user_id;
    // Check if authenticated user is authorized to update
    if (user_id_byToken !== user_id) {
        return res.status(403).json({ status: "You are not authorized to access this user!" });
    }

    const fieldsToUpdate = {};
    for (let key in body) {
        if (key === 'user_id' || key === "id") continue; // Exclude updating the user_id itself
        fieldsToUpdate[key] = body[key];
    }
    // Update only the fields provided in the request body
    const query = 'UPDATE USERS_DATA SET ? WHERE user_id = ?';
    pool.query(query, [fieldsToUpdate, user_id], (err, results) => {
        if (err) {
            console.error('Error updating user data:', err);
            return res.status(500).json({ status: "Error updating user data" });
          }
          res.json({ status: "Updation Successful!", user_id: user_id });
    });

  })
  .delete(verifyAdmin, (req, res) => {
    const user_id = req.params.userid;

    const query = 'DELETE FROM USERS_DATA WHERE user_id = ?';
    pool.query(query, [user_id], (err, results) => {
      if (err) {
        console.error('Error deleting user data:', err);
        return res.status(500).json({ status: "Error deleting user data" });
      }
      res.json({ status: "Deleted Successfully!", user_id: user_id });
    });
  });

// ----------------------------------------------------------------


function destroy_container(containerId, userId){
  console.log(`DELETING CONTAINER : ${containerId}`);
  try {
    execSync(`docker stop ${containerId} && docker rm ${containerId}`, (err, stdout, stderr) => {

    });

    console.log(`Stopped and Removed the container : ${containerId}`);

    const query = 'UPDATE slot_log SET port = NULL, interval_id = NULL, containerId = NULL WHERE user_id = ?';
    pool.query(query, [userId], (err, results) => {
        if (err) {
            console.error('Error updating removal of container in slot_log!:', err);
            return;
        }
        console.log(`Stopped and Removed the container : ${containerId}`);
    });

  }
  catch (err) {
    console.error('Error deleting the container!');
  }
}


function modify_cont_status(user_id, slot_date, slot_time_from, slot_time_to, containerId, intervalId) {
  const to_date = new Date(slot_date).toLocaleDateString();
  const now = new Date();

  const query = 'SELECT booked_slot FROM slot_log WHERE user_id = ?';
  pool.query(query, [user_id], (err, results) => {
    if (err) {
      console.error('Error updating user data:', err);
      return res.status(500).json({ status: "Error updating user data" });
    }
    try{
        const booked_slot = results[0].booked_slot[0];
        const total = Date.parse(`${to_date} ${booked_slot.time_to}`) - Date.parse(now);
        const seconds = String(Math.floor( (total/1000) % 60 )).padStart(2, '0');
        const minutes = String(Math.floor( (total/1000/60) % 60 )).padStart(2, '0');
        const hours = String(Math.floor( (total/(1000*60*60)) )).padStart(2, '0');
        // const days = Math.floor( total/(1000*60*60*24) );

        if(hours <= 0 && minutes <= 0 && seconds <= 0){
            console.log(`TIME_LEFT => 00:00:00`);
            console.log(`Ending the Session and Destroying the Container...`);
            destroy_container(containerId, user_id);
            clearInterval(intervalId);
        }
        else {
            console.log(`${user_id} : TIME_LEFT => ${hours}:${minutes}:${seconds}`);
        }
    }
    catch (err) {
        console.log('error in deleting container.. ERROR : ', err);
    }
    
  });
}


// ROUTINGS FOR WEB_IDE -------------------------------------------

app.get('/eyantra_web_ide', verifyToken, checkBookingDetails, is_slot_on, (req, res) => {
  const user = req.user;
  const userId = user.user_id;
  const booking_details = req.booking_details;
  const booked_slot = req.booked_slot; // need to change in future ---
  const web_ide_PORT = generateRandomPort(10000, 65534); // choose a random port for exposing ide --

  // Remove any previous Interval when this req. is called (new container formation req.)--
  if(booking_details.interval_id){
    clearInterval(Number(booking_details.interval_id));
  }
  booking_details.intervalId = null;
  // -------
  console.log("MESSAGE FROM CLIENT SIDE: ", req.headers.msg);
  
  // This checks if in case there is a existing web ide port, if yes then check it's active or not, and if not active then delete the port data from slot_log file -----
  if (req.headers.msg === "PORT ERROR") {
    try {
      execSync(`docker rm -f ${userId}`, (err, stdout, stderr) => {
  
      });
      console.log(`Stopped and Removed the container : ${containerId}`);
    }
    catch (err) {
      console.error('Error deleting the container!');
    }
    // Update slot_log in DB to remove port and containerId
    const updateSlotLogQuery = 'UPDATE slot_log SET port = NULL, containerId = NULL WHERE user_id = ?';
    pool.query(updateSlotLogQuery, [userId], (updateErr, updateResult) => {
      if (updateErr) {
        console.error('Error updating slot_log in MySQL:', updateErr);
        return res.status(500).json({ status: 'FAILURE', msg: 'Error updating slot_log in MySQL' });
      }
      
      console.log(`Removed port and containerId for user ${userId} in slot_log`);
    });
  }

  // Check if user already has a port assigned
  const existingSlotPORT = booking_details.port;
  console.log("EXISTING SLOT PORT : ", existingSlotPORT);

  // Create Docker container for user
  const volumeName = userId;
  const volumeDir = `/config/${userId}`;
  const workspaceDir = `/config/${userId}/workspace/`;
  // this extension gallery is of microsoft (No one other than microsoft is authorized to use it ,not even us) - But who cares hahaha , we will use ;p----- (source - https://github.com/headmelted/codebuilds/blob/508a782f589c3bf95fc3885e90e52f2dbc2acaa2/overlays/product.json)
  const extensionGallery = '{"serviceUrl": "https://marketplace.visualstudio.com/_apis/public/gallery", "cacheUrl": "https://vscode.blob.core.windows.net/gallery/index", "itemUrl": "https://marketplace.visualstudio.com/items", "controlUrl": "https://az764295.vo.msecnd.net/extensions/marketplace.json", "recommendationsUrl": "https://az764295.vo.msecnd.net/extensions/workspaceRecommendations.json.gz"}';
  const flags = '--disable-update-check';

  exec(`docker run -d --name ${userId} -p ${web_ide_PORT}:8443 -v ${volumeName}:${volumeDir}  -e SETUP_SEPERATE_WORKSPACE="true" -e USER_ID=${userId} -e DEFAULT_WORKSPACE=${workspaceDir} -e EXTENSIONS_GALLERY='${extensionGallery}' -e SUDO_PASSWORD='0000' lscr.io/linuxserver/code-server:latest`
    , (err, stdout, stderr) => {

    if (err) {
        if (existingSlotPORT && stderr.includes(`Conflict. The container name "/${userId}" is already in use`)) {
          const port = existingSlotPORT;
          console.log(`Container already running on PORT ${port}, Redirecting to that`);
          // Set interval(repeting function in interval of every second) to check the countdown and if over then to stop and remove container ---
          const containerId = booking_details.containerId;
          
          if(containerId != '' && containerId != undefined){
            // const booked_slot = slot_log[slotIndex].booked_slot;
            const intervalId = setInterval(() => {
              modify_cont_status(userId, booked_slot.date, booked_slot.time_from, booked_slot.time_to, containerId, Number(booking_details.interval_id));
            }, 1000);
            booking_details.interval_id = Number([intervalId]);
          }
          return res.json({ status: "SUCCESS", port });
        }
        else if(stderr.includes(`Conflict. The container name "/${userId}" is already in use`)) {
          console.log(`Conflict error: ${stderr}`);
          // Remove the existing container
          execSync(`docker rm -f ${userId}`, (rmErr, rmStdout, rmStderr) => {
            if (rmErr) {
              console.error(`Failed to remove container: ${rmStderr}`);
            }
          });
          booking_details.containerId = null;
          booking_details.port = null;
          console.log(`Removed existing container ${userId} and it's interval. Retrying container creation...`);
          // Retry creating the Docker container (ASK USER TO CLICK ON "START DEVELOPMENT BUTTON" AGAIN!)
          return res.json({status: "FAILURE", msg: "Retrying to create a new instance...", job: "TRY AGAIN"});
        }
        else {
          console.error(err);
          return res.sendStatus(500);
        }
    }

    const containerId = stdout.trim();
    console.log("ID OF CONTaINER", containerId);
    
    // Set interval(repeting function in interval of every second) to check the countdown and if over then to stop and remove container ---
    if(containerId != '' && containerId != undefined){
      // const booked_slot = slot_log[slotIndex].booked_slot;
      const intervalId = setInterval(() => {
        modify_cont_status(userId, booked_slot.date, booked_slot.time_from, booked_slot.time_to, containerId, Number(booking_details.interval_id));
      }, 1000);
      booking_details.interval_id = Number([intervalId]);
    }

    // set the PORT section in slot_log table for corresponding user ------
    booking_details.port = web_ide_PORT;
    booking_details.containerId = containerId;

    // Update slot_log in MySQL with new data
    const updateSlotLogQuery = 'UPDATE slot_log SET port = ?, containerId = ?, interval_id = ? WHERE user_id = ?';
    pool.query(updateSlotLogQuery, [booking_details.port, booking_details.containerId, booking_details.interval_id, userId], (updateErr, updateResult) => {
      if (updateErr) {
        console.error('Error updating slot_log in MySQL (/eyrc_web-ide):', updateErr);
        return res.status(500).json({ status: 'FAILURE', msg: 'Error updating slot_log in MySQL (/eyrc_web-ide)' });
      }

      console.log(`Updated slot_log for user ${userId} : (/eyrc_web-ide)`);
    });
    

    return res.json({ containerId, status: "SUCCESS", port: web_ide_PORT });

  });
});










app.get('/web_ide', verifyToken, checkBookingDetails, is_slot_on, (req, res) => {
  const web_ide_port = req.headers['x-web-ide-port'];
  const userId = req.user.user_id;
  const token = req.headers.authorization.split(" ")[1];

  axios.get(`http://localhost:${web_ide_port}/?folder=/`, { timeout: 10000 })
        .then(response => {
            if (response.status === 200) {
                console.log("IDE_PAGE Good to go!");
                
                console.log("PORT OF WEB IDE : ", web_ide_port);
                res.json({status: "Ready", msg: `<!DOCTYPE html>
              <html lang="en">
              <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <meta name="description" content="e-Yantra Robotics Compeititon">
                  <meta name="description" content="Innovation Challenge">
                  <meta name="description" content="IIT Bombay">
                  <meta name="description" content="Robotics">
                  <meta name="description" content="Technical">
                  <meta name="description" content="IITB Internship">
                  <meta name="author" content="e-Yantra">
                  <meta name="csrf-token" content="unkaGrJ9K8wUMQt4LbfiuaXDDzZIVZT66atl21dk">
                  <!-- favicon -->
                  <link rel="apple-touch-icon" sizes="180x180" href="https://portal.e-yantra.org/img/favicon_io/apple-touch-icon.png">
                  <link rel="icon" type="image/png" sizes="32x32" href="https://portal.e-yantra.org/img/favicon_io/favicon-32x32.png">
                  <link rel="icon" type="image/png" sizes="16x16" href="https://portal.e-yantra.org/img/favicon_io/favicon-16x16.png">
                  <link rel="manifest" href="https://portal.e-yantra.org/img/favicon_io/site.webmanifest">
                  <title>e-Yantra Web-IDE</title>
                  <style>
                      @font-face {
                        font-family: 'Space Mono';
                        src: url('./fonts/space_mono.woff2') format('woff2');
                      }
                      @font-face {
                        font-family: 'Orbitron';
                        src: url('./fonts/orbitron.woff2') format('woff2');
                      }
                      body, html {
                          margin: 0;
                          padding: 0;
                          height: 100%;
                          overflow: hidden;
                      }
                      .container {
                          position: relative;
                          width: 100%;
                          height: 100%;
                      }
                      iframe {
                          position: absolute;
                          top: 0;
                          left: 0;
                          width: 100%;
                          height: 100%;
                          border: none;
                      }
                      .upload-btn {
                          position: absolute;
                          top: 3px;
                          left: 5px;
                          z-index: 10;
                          /* background-color: #005fb8; */
                          background-color: #197d29;
                          color: white;
                          border: none;
                          padding: 2px 20px;
                          mix-blend-mode: exclusion;
                          cursor: pointer;
                          font-size: 16px;
                          font-family: "Space Mono", sans-serif;
                          font-weight: 600;
                          border-radius: 4px;
                      }
                      .time-left {
                          position: absolute;
                          top: 4px;
                          right: 6em;
                          z-index: 10;
                          mix-blend-mode: difference;
                          color: white;
                          border: none;
                          padding: 3px 10px;
                          cursor: pointer;
                          font-size: 16px;
                          font-family: "Orbitron", sans-serif;
                          font-weight: 600;
                          border-radius: 4px;
                          transform: scale(0.9);
                          text-shadow: 0 0 2px #fff, 0 0 10px #fff, 0 0 52px #fff;
                      }
                      #time-left-small {
                          display: none;
                      }

                      @media screen and (max-width: 1240px) {
                          #time-left-wide {
                              display: none;
                          }
                          #time-left-small {
                              display: block;
                              right: 7em;
                          }
                      }

                      @media screen and (max-width: 950px) {
                          #time-left-small {
                              display: block;
                              transform: scale(0.7) translateX(-50%);
                              top: unset;
                              bottom: -2px;
                              right: unset;
                              left: 40%;
                          }
                      }
                      
                      @media screen and (max-width: 820px) {
                          #time-left-small {
                              transform: scale(0.8) translateX(-50%);
                              top: unset;
                              bottom: 1.5em;
                              background-color: #005fb8;
                              right: unset;
                              left: 50%;
                          }
                      }
                  </style>
                  <script src="/socket.io/socket.io.js"></script>
                  <script src="jquery-3.7.1.min.js"></script>
              </head>
              <body>
                  <div class="container" role="application">
                      <button class="upload-btn" onclick="uploadToGithub()">UPLOAD</button>
                      <div id="time-left-wide" class="time-left" title="Time Left">00 hrs : 00 min : 00 sec</div>
                      <div id="time-left-small" class="time-left" title="Time Left">00 : 00 : 00</div>
                      <iframe aria-hidden="true" sandbox="allow-scripts allow-same-origin" allow="usb; serial; hid; cross-origin-isolated; clipboard-read; clipboard-write" src="http://localhost:${web_ide_port}/?folder=/config/${userId}/workspace/"></iframe>
                  </div>

                  <script>
                    const user_id = ${req.user.id};
                    const token = "${token}";

                    const socket_ide = io('http://localhost:8000', {
                        auth: {
                            token: token
                        }
                    });

                    socket_ide.on('connect_error', (error) => {
                        console.error('Connection error:', error);
                    });

                    socket_ide.on('disconnect', () => {
                        console.log('Disconnected from server');
                    });

                    socket_ide.on('connect', () => {
                        console.log('Connected to server (IDE)');
                    });

                    $.ajax({
                      type: "GET",
                      url: "api/slot_book",
                      headers: {
                          'Authorization': 'Bearer ' + token
                      },
                      data: {
                          user_id: user_id
                      },
                      dataType: "json",
                      success: function(res) {
                        if (res.is_booked === "YES") {
                          const booked_slot = res.slot.booked_slot[0];
                          if(res.status === "Ongoing"){
                                  console.log("Slot Ongoing");
                                  $('#time_info').html('Slot Status:&ensp;Ongoing');
                                  
                                  socket_ide.on('time', (data) => {
                                      const dateStr = booked_slot.date + " " + booked_slot.time_to;
                                      const countdown = compareWithCurrentDate(dateStr, data.datetime);
                                      $('#time-left-wide').html(countdown[0] + " hrs : " + countdown[1] + " min : " + countdown[2] + " sec");
                                      $('#time-left-small').html(countdown[0] + " : " + countdown[1] + " : " + countdown[2]);
                                      if (countdown[0] <= 0 && countdown[1] <= 0 && countdown[2] <= 0){
                                          location.reload(true);
                                      }
                                  });
                              }
                        }
                      }
                    });

                    function uploadToGithub() {
                          // This is a simplified example. In a real-world scenario,
                          // you would need to handle authentication with GitHub,
                          // retrieve the file(s) from the VS Code workspace, and then
                          // use the GitHub API to upload the file(s).

                          alert("Upload to GitHub functionality goes here!");

                          // Example of what you might do:
                          // 1. Use the GitHub API to authenticate and get an access token.
                          // 2. Retrieve the file(s) from the VS Code workspace.
                          // 3. Use the GitHub API to upload the file(s) to a repository.

                          // For more details, refer to the GitHub API documentation:
                          // https://docs.github.com/en/rest/reference/repos#create-or-update-file-contents
                      }

                      // Function to determine the time diffrence b/w given time and current time ------(COUNTDOWN)---------

                      function compareWithCurrentDate(dateStr, d) {
                          // Parse the input date string in the format DD/MM/YYYY HH:mm
                          const [datePart, timePart] = dateStr.split(' ');
                          const [year, month, day] = datePart.split('-').map(Number);
                          const [hours, minutes, sec] = timePart.split(':').map(Number);
                          
                          // Create a Date object for the input date
                          const inputDate = new Date(year, month - 1, day, hours, minutes);
                      
                          // Calculate initial difference in milliseconds
                          let timeDifference = inputDate.getTime() - d;
                          return showTimeDifferenceStatus(timeDifference);
                      }
                      
                      function showTimeDifferenceStatus(diffInMilliseconds) {
                          if (diffInMilliseconds > 0) {
                              return formatTimeDifference(diffInMilliseconds);
                          } else if (diffInMilliseconds < 0) {
                              return [0, 0, 0];
                          } else {
                              return [0, 0, 0];
                          }
                      }
                      
                      function formatTimeDifference(diffInMilliseconds) {
                          const totalSeconds = Math.abs(diffInMilliseconds / 1000);
                          const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
                          const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
                          const seconds = String(Math.floor(totalSeconds % 60)).padStart(2, '0');
                      
                          return [hours, minutes, seconds];
                      }
                      
                      // ----------------------------
                  </script>
              </body>
              </html>
              `});


            } else {
              console.log("IDE_PAGE Not Ready!");
              res.json({status: "Not Ready"});
            }
        })
        .catch(error => {
            console.log(`IDE_PAGE Not Ready! Error : ${error}`);
            res.json({status: "Not Ready"});
  });
});


























// ----------------------------------------------------------------

server.listen(PORT, () => {
  console.log("Server is running on port " + PORT + "!");
});

// const myServer = http.createServer(app);

// myServer.listen(8000, () => {
//     console.log("Server is running on port 8000");
// });
