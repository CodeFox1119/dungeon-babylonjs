import { Dungeon } from './Dungeon.js'

window.addEventListener("DOMContentLoaded", function () {
    init();
});


function init() {
    console.log("startup");
    new Dungeon(document.getElementById('renderCanvas'));
}
