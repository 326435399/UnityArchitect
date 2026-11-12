using UnityEngine;
using Battle.Data;

namespace Battle.Data
{
    public class DataBinder : MonoBehaviour
    {
        [SerializeField] private HealthData bound;

        public void Bind(HealthData data)
        {
            bound = data;
        }
    }
}
