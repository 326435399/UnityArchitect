using UnityEngine;

public class G1View : MonoBehaviour
{
    public G1DataBase db;
    private void OnEnable() { db.State.Changed += Refresh; }
    private void OnDisable() { db.State.Changed -= Refresh; }
    public void Refresh() { int s = db.State.Score; }
}
