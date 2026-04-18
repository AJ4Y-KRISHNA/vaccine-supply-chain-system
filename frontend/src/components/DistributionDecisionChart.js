import { Bar } from "react-chartjs-2";

const DistributionDecisionChart = ({ decision }) => {

return (
<Bar
data={{
labels: ["Forecast Demand", "Recommended Supply"],
datasets: [
{
label: "AI Distribution Decision",
data: [
decision.forecast_demand,
decision.recommended_distribution
]
}
]
}}
/>
);

};

export default DistributionDecisionChart;