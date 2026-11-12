using UnityEngine;
using Battle.Data;

namespace Battle.Core
{
    public class GameRoot : MonoBehaviour
    {
        [SerializeField] private HealthData db;
        [SerializeField] private DataBinder binder;

        private void Start()
        {
            binder.Bind(db);
        }
    }
}
