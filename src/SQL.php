<?php
class SQL
{
    public $db;
    public $host;
    public $dbname;
    public $username;
    public $password;
    public $charset;
    public function __construct (string $host, string $dbname, string $username, string $password, ?string $charset = null)
    {
        $this -> host = $host;
        $this -> dbname = $dbname;
        $this -> username = $username;
        $this -> password = $password;
        $this -> charset = $charset == null ? 'utf8' : $charset;
    }
    public function initialize ()
    {
        try
        {
            $p1 = "mysql:host=" . $this -> host . ";dbname=" . $this -> dbname . ";charset=" . $this -> charset;
            $p2 = $this -> username;
            $p3 = $this -> password;
            $this -> db = new PDO($p1, $p2, $p3, [ PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION ]);
        }
        catch (Exception $e)
        {
            return $e;
        }
        finally
        {
            return true;
        }
    }
    /**
     * @param string $request The request who will be executed
     * @param Array $variables The variables necessary to the request
     */
    public function request (string $request, ?Array $variables = [])
    {
        $request = $this -> db -> prepare($request);
        $request -> execute($variables);
        return $request;
    }
}
?>