<?php
require_once __DIR__.'/src/loader.php';
auth();
// var_dump($_COOKIE['goto']);
// if (isset($_COOKIE['goto'])) {
//     header('Location: ' . $_COOKIE['goto']);
// }
$user = json_decode(file_get_contents($_ENV['SERVER'] . 'api/user/get.php?keys=name,lang', false, $_ENV['CONTEXT']), true);
// $data = json_decode(json_decode(file_get_contents($_ENV['SERVER'] . 'api/client/data/get.php?client_id=' . $_ENV['CLIENT_ID'] . '&client_secret=' . $_ENV['CLIENT_SECRET'] . '', false, $context), true)['data'], true);
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="/styles/main.css">
    <title>Bet</title>
</head>

<body>
    <h1>Hello <?= $user['name'] ?></h1>
    <p>Viewing this website in <?= $user['lang'] ?> according to your account preferences.</p>
</body>

</html>