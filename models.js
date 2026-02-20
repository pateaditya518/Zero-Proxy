const Datastore = require('nedb-promises');
const path = require('path');

// Ensure database files are saved in a specific directory
const dbPath = path.join(__dirname, 'database');

module.exports = {
    Student: Datastore.create({ filename: path.join(dbPath, 'students.db'), autoload: true }),
    Timetable: Datastore.create({ filename: path.join(dbPath, 'timetable.db'), autoload: true }),
    Attendance: Datastore.create({ filename: path.join(dbPath, 'attendance.db'), autoload: true })
};
