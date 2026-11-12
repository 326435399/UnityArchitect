using UnityEngine;

namespace Battle.Data
{
    [CreateAssetMenu(menuName = "Battle/Health")]
    public class HealthData : ScriptableObject
    {
        public int maxHp = 100;
        [SerializeField] private AnimationCurve regenCurve;
    }
}
