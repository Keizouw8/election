import { randomBytes } from "crypto";
import Population from "../game/population.js";

var characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
var rooms = {};

export class Room{
    constructor(){
        this.id = new Array(4).fill(0).map(() => characters[Math.floor(Math.random() * characters.length)]).join("");
        this.host = false;
        this.hostCode = randomBytes(10).toString("hex").toUpperCase();
        this.ingame = false;
        this.users = {};
        this.owner = false;
        this.population = new Population(1e4);
    }

    setHost(host){
        this.host = host;
        var that = this;

        host.on("ingame", () => that.ingame = true);

        host.on("cutscene", () => Object.values(that.users).forEach(user => user.socket.emit("cutscene")));

        host.on("winner", function(winner, loser){
            var winnerPopularity = that.users[winner]?.quality;
            var loserPopularity = that.users[loser]?.quality;

            if(winnerPopularity == undefined || loserPopularity == undefined) return;

            var differential = Math.abs(winnerPopularity - loserPopularity) / 3;
            if(!differential) differential = 0.1;
            
            that.users[winner].quality = Math.min(1, that.users[winner].quality + differential);
            that.users[loser].quality = Math.max(0, that.users[loser].quality - differential);

            that.users[winner].socket.emit("popularity", that.users[winner].quality);
            that.users[loser].socket.emit("popularity", that.users[loser].quality);
        });

        host.on("startRound", function(dontClear){
            var users = Object.values(that.users).map((user) => ({
                id: user.id,
                name: user.name,
                properties: user.properties
            }));

            Object.values(that.users).forEach(user => user.socket.emit("startRound", users, dontClear));
        });

        host.on("message", function(message, to){
            if(to) return to.forEach((user) => that.users[user]?.socket?.emit("message", message));
            Object.values(that.users).forEach(user => user.socket.emit("message", message));
        });

        host.on("callback", function(message, to){
            if(!to) to = Object.keys(that.users);
            to.forEach(function(user){
                that.users[user].socket.emit("callback", message);
            });
        });

        host.on("endRound", function(cb){
            var results = that.population.vote(that.users);
            for(var result of Object.keys(results)){
                that.users[result].money += results[result][1];
                that.users[result].socket.emit("money", that.users[result].money);

                results[result] = {
                    votes: results[result][0],
                    made: results[result][1],
                    name: that.users[result].name,
                    money: that.users[result].money,
                    properties: that.users[result].properties
                };
                that.users[result].finished = false;
            }

            that.population.nextGeneration({
                ideals: -0.05 + Math.random() * 0.1,
                income: -0.05 + Math.random() * 0.1,
                occupation: -0.05 + Math.random() * 0.1,
                race: -0.05 + Math.random() * 0.1
            });

            cb(results);
        });

        host.on("disconnect", function(){
            Object.values(that.users).forEach(user => user.socket.emit("dc"));
            delete rooms?.[this.id];
        });
    }

    join(user){
        this.users[user.id] = user;
        this.host.emit("join", user.object());
        user.socket.on("disconnect", () => this.leave(user.id));

        if(this.owner) return;
        this.owner = user.id;
        this.host.emit("owner", user.id);
        user.socket.emit("owner");
    }

    leave(id){
        delete this.users[id];
        this.host.emit("leave", id);

        if(this.owner != id) return;
        this.owner = Object.keys(this.users)[0] || false;
        this.host.emit("owner", this.owner);
        this.users?.[this.owner]?.socket?.emit("owner");
    }
};

export default rooms;