
/**
 * Module dependencies.
 */

var express = require('express');
var routes = require('./routes');
var user = require('./routes/user');
var http = require('http');
var path = require('path');

var app = express();
var server = http.createServer(app);
var io = require('socket.io').listen(server);
var _ = require('underscore');

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());
app.use(express.cookieParser('hey joe'));
app.use(express.session());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}

app.get('/users', user.list);
// ADDINGS_BEGIN
app.get('/', routes.chat);
// ADDINGS_END

server.listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});

// users which are currently connected to the chat
    // Example with two users connected: 
    // {
    //  'foo' : { 'username' : 'foo', 'job' : 'admin'},
    //  'bar' : { 'username' : 'bar', 'job' : 'user'}
    // }
var users = {};

// rooms which are currently available in chat
// We name rooms automatically room1, room2, etc...
var rooms = [];

io.sockets.on('connection', function (socket) {

    // when the client emits 'adduser', this listens and executes
    socket.on('adduser', function(username){
        // store the username in the socket session for this client
        socket.username = username;

        // ADDINGS_BEGIN
        // We check for first available room
        var i = 1;
        while(_.size(io.sockets.clients('room' + i)) == 5){
            i++;
        }
        var roomHome = 'room' + i;
        // ADDINGS_END

        // store the room name in the socket session for this client
        socket.room = roomHome;

        // ADDINGS_BEGIN
        // Check if roomHome is in the rooms array.
            // NB: if condition is true, it means that all available rooms are full, so we create roomHome
            //     In this case we also set the job property to admin, 
            //     because the user is the first on this room, 
            //     so he only will be able to bann users (from all the rooms)
        if(_.indexOf(rooms, roomHome) == -1) {
            rooms.push(roomHome);
            // echo to all clients the new room
            io.sockets.emit('createroom', rooms, roomHome);
            users[username] = {'username': username, 'job' : 'admin' };
        } else {
            // Here the user enters a room that isn't empty, so there's already an admin
            socket.emit('createroom', rooms, roomHome);
            users[username] = {'username': username, 'job' : 'user' };
        }
        // ADDINGS_END

        // MODIF 'room1' -> roomHome
        // send client to roomHome
        socket.join(roomHome);
        // echo to client they've connected
        socket.emit('updatechat', 'SERVER', 'you have connected to ' + roomHome);
        // echo to roomHome that a person has connected to their room
        socket.broadcast.to(roomHome).emit('updatechat', 'SERVER', username + ' has connected to this room');

        // ADDINGS_BEGIN
        // update list of users in chat, client-side
        io.sockets.emit('updateusers', users);
        // ADDINGS_END
    });

    // when the client emits 'sendchat', this listens and executes
    socket.on('sendchat', function (data) {
        // we tell the client to execute 'updatechat' with 2 parameters
        io.sockets.in(socket.room).emit('updatechat', socket.username, data);
    });

    socket.on('switchRoom', function(newroom){
        // Check if the  new room is full
        // ADDINGS_BEGIN condition if et block if
        if(_.size(io.sockets.clients(newroom)) == 5){
            socket.emit('fullnewroom', 'SERVER', 'can\'t switch to ' + newroom + ': full.');
        } else {
            // leave the current room (stored in session)
            socket.leave(socket.room);
            // join new room, received as function parameter
            socket.join(newroom);
            socket.emit('updatechat', 'SERVER', 'you have connected to '+ newroom);
            // sent message to OLD room
            socket.broadcast.to(socket.room).emit('updatechat', 'SERVER', socket.username+' has left this room');
            // update socket session room title
            socket.room = newroom;
            socket.broadcast.to(newroom).emit('updatechat', 'SERVER', socket.username+' has joined this room');
            // update list of rooms in chat, client-side
            socket.emit('updaterooms', rooms, newroom);
        }
    });

    // ADDINGS_BEGIN
    socket.on('searchuser', function(usersearched){
        // Check if the username is online
        if(_.indexOf(_.keys(users), usersearched) != -1){
            socket.emit('searchresult', usersearched + ' is ONLINE.');
        } else {
            socket.emit('searchresult', usersearched + ' is OFFLINE.');
        }
    });
    // ADDINGS_END

    // ADDINGS_BEGIN
    socket.on('bannuser', function(userbanned){
        // Check if the user asking to bann another is the admin
        if(users[socket.username].job == 'admin'){

            // Check if the user to bann is online
            if(_.indexOf(_.keys(users), userbanned) != -1){

                // Check if the user to bann is an admin
                if(users[userbanned].job == 'user'){
                    socket.emit('bannresult', userbanned + ' has been banned.');
                    socket.broadcast.to(socket.room).emit('banninguser', userbanned);
                } else { socket.emit('bannresult', 'You can\'t bann an admin'); }

            } else { socket.emit('bannresult', userbanned + ' is OFFLINE, can\'t bann.'); }

        } else { socket.emit('bannresult', 'Only the room admin can bann.'); }
    });
    // ADDINGS_END

    // ADDINGS_BEGIN
    socket.on('bannme', function(userbanned){
        if (socket.username == userbanned) {
            delete users[userbanned];
            io.sockets.in(socket.room).emit('updatechat', 'SERVER', 'user '+ userbanned + ' has been banned by admin');
            // Close the client connection
            socket.manager.onClientDisconnect(socket.id);
        }
    });
    // ADDINGS_END

    // when the user disconnects.. perform this
    socket.on('disconnect', function(){
        // remove the username from global users list
        delete users[socket.username];
        // update list of users in chat, client-side
        io.sockets.emit('updateusers', users);
        // echo globally that this client has left
        socket.broadcast.emit('updatechat', 'SERVER', socket.username + ' has disconnected');
        socket.leave(socket.room);
    });
});