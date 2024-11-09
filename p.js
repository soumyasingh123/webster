console.log(new Date());
const now = new Date();
const end = now;
now.setMinutes((now).getMinutes() + 2);
const start = (end>=now)?end:now;
console.log(start);