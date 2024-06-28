$(document).ready(function(){
    // const username, booked_slot;
    const user_id = 'CL_1243';
    const token = "68be0b1d-c6e0-4a92-826a-83844220c670";

    const socket = io('http://localhost:8000', {
        auth: {
            token: token
        }
    });

    // const socket_john = io('http://localhost:8000', {
    //     auth: {
    //         token: token
    //     }
    // });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });

    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    // TODO: Load user data (then store it in cookie or local storage)
    $.ajax({
        type: "GET",
        url: "api/users/" + user_id,
        headers: {
            'Authorization': 'Bearer ' + token
        },
        dataType: "json",
        success: function(res) {
            console.log(res);
        },
        error: function(err) {
            console.error("Error:", err);
        }
    });


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
            console.log(`Time difference: ${String(formatTimeDifference(diffInMilliseconds))}`);
            return formatTimeDifference(diffInMilliseconds);
        } else if (diffInMilliseconds < 0) {
            console.log('Current time is past the given time');
            return [0, 0, 0];
        } else {
            console.log('Current time is equal to the given time');
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



    // Check if user has already booked a slot
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
            if (res.status === "Not Booked"){
                return;
            }
            if (res.is_booked === "YES") {
                const booked_slot = res.slot.booked_slot[0];

                $("#slot-booking-box").hide();
                $("#slot-booked-box").show();
                $("#slotDetails").append(`${booked_slot.date} - ${booked_slot.time_from.slice(0, 5)} to ${booked_slot.time_to.slice(0,5)}`);

                if(res.status === "Upcoming"){
                    console.log("Slot Upcoming");
                    $('#time_info').html(`Slot status:&ensp;Upcoming`);
                    $('#start_development').prop('disabled', true);

                    socket.on('time', (data) => {
                        const dateStr = `${booked_slot.date} ${booked_slot.time_from}`;
                        const countdown = compareWithCurrentDate(dateStr, data.datetime);
                        $('#countdown').html(`${countdown[0]} hrs : ${countdown[1]} min : ${countdown[2]} sec`);
                        if (countdown[0] <= 0 && countdown[1] <= 0 && countdown[2] <= 0){
                            location.reload(true);
                        }
                    });
                }
                else if(res.status === "Ongoing"){
                    console.log("Slot Ongoing");
                    $('#time_info').html('Slot Status:&ensp;Ongoing');
                    $('#start_development').prop('disabled', false);
                    
                    socket.on('time', (data) => {
                        const dateStr = `${booked_slot.date} ${booked_slot.time_to}`;
                        const countdown = compareWithCurrentDate(dateStr, data.datetime);
                        $('#countdown').html(`Time left:&ensp;${countdown[0]} hrs : ${countdown[1]} min : ${countdown[2]} sec`);
                        if (countdown[0] <= 0 && countdown[1] <= 0 && countdown[2] <= 0){
                            location.reload(true);
                        }
                    });
                }
                else if (res.status === "Completed") {
                    console.log("Slot Over");
                    $('#time_info').html('Slot Status');
                    $('#countdown').html('Your Slot is Over!')
                    $('#start_development').hide();
                }
                else{
                    console.log("SOME ERROR OCCOURED : STATUS : ", res.status);
                    return;
                }
                
            }
            else {
                console.log("ERROR : ", res);
            }
        },
        error: function(err) {
            console.error("Error:", err);
        }
    });

    $.ajax({
        type: "GET",
        url: "api/available_slots",
        headers: {
            'Authorization': 'Bearer ' + token
        },
        dataType: "json",
        success: function( res ) {
            console.log("Number of slots available : ", res.length);
            $.each(res, function(index, slot) {
                $('#slots').append(`<option value="${slot.id}">[${slot.tag}]  ${new Date(slot.date).toLocaleDateString('en-GB')} - ${slot.time_from.slice(0, 5)} to ${slot.time_to.slice(0, 5)}</option>`);
            });
        }
      });

    $("#slots").change(function (e) {
        console.log($(this).val());
        let val = $(this).val();
        if(val != "") {
            $("#submit_btn").removeAttr("disabled");
        }
        else {
            $("#submit_btn").attr("disabled", true)
        }
    });

    $("#submit_btn").click(function (e) {
        e.preventDefault();
        $.ajax({
            type: "POST",
            url: "api/slot_book",
            headers: {
                'Authorization': 'Bearer ' + token
            },
            data: {
                slot_id: JSON.stringify([String($("#slots").val())]) // this should be a array
            },
            dataType: "json",
            success: function( res ) {
                alert(res.status);
                location.reload(true);
            }
        });
    });

    function start_dev(msg) {
        $.ajax({
            type: "GET",
            url: "/eyantra_web_ide",
            headers: {
                'Authorization': 'Bearer ' + token,
                'msg': msg
            },
            dataType: "json",
            success: function(res) {
                console.log("INITIALIZING CONTAINER!");
                console.log(res);

                if(res.status == "FAILURE"){
                    if(res.job == "TRY AGAIN"){
                        console.log("ERROR! - Retrying to create an instance....")
                        return start_dev(msg="INIT");
                    }
                    return console.log("FAILED to creata an Instance: ERROR : ", res.msg)
                }
    
                if (res.status === "SUCCESS") {
                    if(res.containerId == '') {
                        return console.log("Failed to create an Instance, Maybe TRY again!")
                    }
                    const web_ide_port = res.port;
                    const maxRetries = 5; // Adjust the number of retries as needed
                    let attempt = 0;
                    // This will check if the ide_page is on, if yes then move to the ide or else keep retrying upto five times each of 3 sec and if still no response that means site isn't working ----
                    const checkPort = () => {
                        attempt++;
                        $.ajax({
                            url: `/web_ide`,
                            method: 'GET',
                            timeout: 3000, // Set a timeout for the request
                            headers: {
                                'Authorization': 'Bearer ' + token,
                                'x-web-ide-port': res.port
                            },
                            success: function(response) {
                                console.log(res.status);
                                if(response.status === "Ready"){
                                    console.log("MOVING TO WEB_IDE!");
                                    document.write(response.msg); //the html file is the msg
                                }
                                else {
                                    if (attempt < maxRetries) {
                                        setTimeout(checkPort, 3000); // Retry after 3 seconds
                                    } else {
                                        console.log("Failed to initialize container within the retry limit. Retrying Again...");
                                        start_dev(msg="PORT ERROR");
                                    }
                                }
                            },
                            error: function() {
                                console.log('error in accessing the /web_ide : ', error);
                                start_dev(msg="PORT ERROR");
                            }
                        });
                    };
    
                    checkPort();
                } else {
                    console.error("FAILURE:", res.msg);
                }
            },
            error: function(err) {
                console.error("Error:", err);
            }
        });
    }

    $("#start_development").click((e) => {
        e.preventDefault();
        start_dev(msg="INIT");
    });
    

});