<?php
function auth() {
    session_start();
    if (!isset($_SESSION['token']))
    {
        $state = base64_encode(random_bytes(32));
        $_SESSION['state'] = $state;
        setcookie('goto', $_SERVER['REQUEST_URI'], 0, "/");
        var_dump($_SERVER['REQUEST_URI']);
        header('Location: ' . $_ENV['SERVER'] . 'auth/authorize.php?response_type=code&client_id=' . $_ENV['CLIENT_ID'] . '&redirect_uri=' . $_ENV['AUTH'] . '&state=' . urlencode($state));
        die;
    }
    $_ENV['TOKEN'] = $_SESSION['token'];
    $_ENV['CONTEXT'] = stream_context_create([
        'http' => [
            'header' => "Authorization: Bearer " . $_ENV['TOKEN']
        ]
    ]);
}
?>