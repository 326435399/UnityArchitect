using System;

public class G1State
{
    public event Action Changed;
    private int score;
    public int Score
    {
        get { return score; }
        set { score = value; }
    }
    public void Fire()
    {
        Changed?.Invoke();
    }
}
