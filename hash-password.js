// hash-password.js
const bcrypt = require('bcrypt');
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

readline.question('Please enter the admin password you want to use: ', password => {
    if (!password) {
        console.error('Password cannot be empty.');
        readline.close();
        return;
    }

    // The 'salt' is a random value that makes the hash stronger. 10 is a good standard value.
    const saltRounds = 10;
    bcrypt.hash(password, saltRounds, (err, hash) => {
        if (err) {
            console.error('Error hashing password:', err);
            return;
        }
        console.log('\nPassword hashing successful!');
        console.log('Copy the following line into your .env file:\n');
        console.log(`ADMIN_PASSWORD_HASH=${hash}`);
    });
    readline.close();
});

//**ADMIN_PASSWORD_HASH=$2b$10$0K2X8K2kw./cQSxLv8BI/eSTEgDpsSK0uLkKmKXpjDEWA.j7vzgFS */